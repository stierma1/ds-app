import {
  assertDefined,
  assertInteger,
  ContainerBase,
  readInteger,
  readNumber,
} from "../core/index.ts";
import { BinaryHeap } from "./binary-heap.ts";
import {
  parseEvents,
  serializeEvents,
} from "./serialization.ts";
import type { CalendarQueueOptions, TimerQueue, TimingWheelOptions } from "./types.ts";

interface TimerEvent<T> {
  id: number;
  time: number;
  seq: number;
  /** Tick index used by TimingWheel; CalendarQueue leaves it at 0. */
  tick: number;
  value: T;
  cancelled: boolean;
}

function compareEvents<T>(a: TimerEvent<T>, b: TimerEvent<T>): number {
  return a.time - b.time || a.seq - b.seq;
}

function requireTime(time: number, name = "time"): number {
  if (typeof time !== "number" || !Number.isFinite(time)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  return time;
}

function requirePositive(value: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
  return value;
}

function requireNow(now: number): number {
  if (typeof now !== "number" || !Number.isFinite(now) || now < 0) {
    throw new RangeError("now must be a non-negative finite number");
  }
  return now;
}

/**
 * Brown's calendar queue over a moving "year" of buckets, with a binary min-heap for events that
 * fall beyond the current year. Events are bucketed by time, so schedule and the common advance
 * path are O(1) amortized when event times are spread evenly; a far-future overflow event costs
 * O(log m) until the year reaches it. Crossing years drains due overflow events and redistributes
 * the rest in heap order. The bucket count doubles when the overflow grows past twice the number of
 * buckets, which keeps that overhead bounded.
 *
 * Ties are delivered by scheduling order. Cancellation is lazy: the id is removed from the index
 * and the event is skipped when its bucket is next examined. `advance(t)` sets `now = t` and returns
 * every event with time <= t in non-decreasing time order.
 */
export class CalendarQueue<T> extends ContainerBase<T> implements TimerQueue<T> {
  private _bucketCount: number;
  private _bucketWidth: number;
  private _buckets: Array<Array<TimerEvent<T>>>;
  private _overflow = new BinaryHeap<TimerEvent<T>>(compareEvents);
  private _eventsById = new Map<number, TimerEvent<T>>();
  private _yearStart: number;
  private _now: number;
  private _cursor: number;
  private _nextId = 1;
  private _seq = 0;
  private _cachedPeek: number | null | undefined = undefined;

  constructor(options: CalendarQueueOptions = {}) {
    super();
    const bucketCount = options.bucketCount ?? 32;
    assertInteger(bucketCount, "bucketCount");
    if (bucketCount < 1 || bucketCount > 0x100000) {
      throw new RangeError("bucketCount must be in [1, 1048576]");
    }
    this._bucketCount = bucketCount;
    this._bucketWidth = requirePositive(options.bucketWidth ?? 1, "bucketWidth");
    this._now = requireNow(options.now ?? 0);
    this._yearStart = Math.floor(this._now / this.yearLength) * this.yearLength;
    this._buckets = this.createBuckets();
    this._cursor = this.bucketIndex(this._now);
  }

  /** O(1) amortized: the current simulation time. */
  get now(): number {
    return this._now;
  }

  /** O(1) amortized; O(log m) when the event lands in the overflow heap. */
  schedule(time: number, value: T): number {
    requireTime(time);
    assertDefined(value);
    if (time < this._now) {
      throw new RangeError("cannot schedule an event before now");
    }
    const event: TimerEvent<T> = {
      id: this._nextId++,
      time,
      seq: this._seq++,
      tick: 0,
      value,
      cancelled: false,
    };
    this._eventsById.set(event.id, event);
    this._size++;
    this.place(event);
    if (this._overflow.size > this._bucketCount * 2) {
      this.grow();
    }
    this._cachedPeek = undefined;
    this.touch();
    return event.id;
  }

  /** O(1): marks the event cancelled and removes it from the id index. */
  cancel(id: number): boolean {
    assertInteger(id, "id");
    const event = this._eventsById.get(id);
    if (event === undefined) {
      return false;
    }
    event.cancelled = true;
    this._eventsById.delete(id);
    this._size--;
    this._cachedPeek = undefined;
    this.touch();
    return true;
  }

  /**
   * O(d + k log k) for k due events and d buckets traversed: advances `now`, drains the buckets up
   * to the target time, and returns the events in time order. Crossing a year also drains due
   * overflow events in heap order.
   */
  advance(time: number): T[] {
    requireTime(time);
    if (time < this._now) {
      throw new RangeError("cannot advance backwards");
    }
    this._cachedPeek = undefined;
    const due: Array<TimerEvent<T>> = [];
    if (time >= this.yearEnd) {
      this.collectBuckets(this._cursor, this._bucketCount - 1, Infinity, due);
      this._cursor = 0;
      const yearLength = this.yearLength;
      this._yearStart = Math.floor(time / yearLength) * yearLength;
      this._buckets = this.createBuckets();
      while (true) {
        const event = this._overflow.peek();
        if (event === undefined || event.time > time) {
          break;
        }
        this._overflow.pop();
        if (!event.cancelled) {
          due.push(event);
          this._eventsById.delete(event.id);
          this._size--;
        }
      }
      while (true) {
        const event = this._overflow.peek();
        if (event === undefined || event.time >= this.yearEnd) {
          break;
        }
        this._overflow.pop();
        if (!event.cancelled) {
          this._buckets[this.bucketIndex(event.time)].push(event);
        }
      }
      this._cursor = this.bucketIndex(time);
    } else {
      const target = this.bucketIndex(time);
      for (let index = this._cursor; index <= target; index++) {
        this.collectBuckets(index, index, index === target ? time : Infinity, due);
      }
      this._cursor = target;
    }
    this._now = time;
    due.sort(compareEvents);
    const values: T[] = new Array(due.length);
    for (let index = 0; index < due.length; index++) {
      values[index] = due[index].value;
    }
    this.touch();
    return values;
  }

  /** O(1) amortized: earliest scheduled time; the first call after a mutation scans the index. */
  peekTime(): number | undefined {
    if (this._cachedPeek === undefined) {
      let minimum: number | null = null;
      for (const event of this._eventsById.values()) {
        if (minimum === null || event.time < minimum) {
          minimum = event.time;
        }
      }
      this._cachedPeek = minimum;
    }
    return this._cachedPeek === null ? undefined : this._cachedPeek;
  }

  /** O(n log n): active events in non-decreasing time order. */
  override toArray(): T[] {
    const events = [...this._eventsById.values()].sort(compareEvents);
    return events.map((event) => event.value);
  }

  /** O(n log n) up front: snapshot iterator in time order. */
  override [Symbol.iterator](): IterableIterator<T> {
    return this.snapshotIterator(this.toArray());
  }

  /** O(n): drops every event; `now` is retained. */
  override clear(): void {
    this._buckets = this.createBuckets();
    this._overflow = new BinaryHeap<TimerEvent<T>>(compareEvents);
    this._eventsById = new Map();
    this._size = 0;
    this._cursor = this.bucketIndex(this._now);
    this._cachedPeek = undefined;
    this.touch();
  }

  /** O(n + buckets): validates calendar geometry, bucket placement, ids, and counts. */
  override validate(): true | string {
    if (this._buckets.length !== this._bucketCount) {
      return "bucket array length does not match bucketCount";
    }
    if (this._bucketWidth <= 0) {
      return "bucketWidth must be positive";
    }
    if (!(this._yearStart <= this._now && this._now < this.yearEnd)) {
      return "now is outside the calendar year";
    }
    if (this._cursor !== this.bucketIndex(this._now)) {
      return "cursor does not match the current bucket";
    }
    if (this._eventsById.size !== this._size) {
      return "id index size does not match size";
    }
    const seen = new Set<TimerEvent<T>>();
    let active = 0;
    for (let index = 0; index < this._buckets.length; index++) {
      const bucket = this._buckets[index];
      for (const event of bucket) {
        if (event.cancelled) {
          continue;
        }
        if (seen.has(event)) {
          return "event appears in more than one bucket";
        }
        seen.add(event);
        active++;
        if (event.value === undefined) {
          return "event value is undefined";
        }
        if (event.time < this._now) {
          return "active event is before now";
        }
        if (this._eventsById.get(event.id) !== event) {
          return "bucket event is missing from the id index";
        }
        if (event.time >= this.yearEnd || event.time < this._yearStart) {
          return "bucket event is outside the current year";
        }
        if (this.bucketIndex(event.time) !== index) {
          return "event is in the wrong bucket";
        }
      }
    }
    for (const event of this._overflow.toArray()) {
      if (event.cancelled) {
        continue;
      }
      if (seen.has(event)) {
        return "event appears in both the calendar and overflow";
      }
      seen.add(event);
      active++;
      if (event.value === undefined) {
        return "overflow event value is undefined";
      }
      if (event.time < this.yearEnd) {
        return "overflow event belongs in the current year";
      }
      if (this._eventsById.get(event.id) !== event) {
        return "overflow event is missing from the id index";
      }
    }
    if (active !== this._size) {
      return `size ${this._size} does not match active event count ${active}`;
    }
    for (const [id, event] of this._eventsById) {
      if (event.id !== id || event.cancelled || !seen.has(event)) {
        return "id index contains a stale or cancelled event";
      }
    }
    return true;
  }

  /** O(n log n): serializes active events in time order with the calendar geometry. */
  override serialize(): string {
    const events = [...this._eventsById.values()].sort(compareEvents);
    return serializeEvents("CalendarQueue", events, {
      now: this._now,
      bucketCount: this._bucketCount,
      bucketWidth: this._bucketWidth,
    });
  }

  /** O(n): restores the calendar geometry, events, ids, and scheduling order. */
  static deserialize<T>(
    json: unknown,
    options: CalendarQueueOptions = {},
  ): CalendarQueue<T> {
    const { record, events } = parseEvents(json, "CalendarQueue");
    const queue = new CalendarQueue<T>({
      bucketCount: options.bucketCount ?? readInteger(record, "bucketCount"),
      bucketWidth: options.bucketWidth ?? readNumber(record, "bucketWidth"),
      now: options.now ?? readNumber(record, "now"),
    });
    queue.restore(events);
    if (queue.validate() !== true) {
      throw new TypeError(`Invalid CalendarQueue payload: ${queue.validate()}`);
    }
    return queue;
  }

  private get yearLength(): number {
    return this._bucketCount * this._bucketWidth;
  }

  private get yearEnd(): number {
    return this._yearStart + this.yearLength;
  }

  private createBuckets(): Array<Array<TimerEvent<T>>> {
    return Array.from({ length: this._bucketCount }, () => []);
  }

  private bucketIndex(time: number): number {
    const index = Math.floor((time - this._yearStart) / this._bucketWidth);
    return Math.min(this._bucketCount - 1, Math.max(0, index));
  }

  private place(event: TimerEvent<T>): void {
    if (event.time >= this.yearEnd) {
      this._overflow.push(event);
      return;
    }
    this._buckets[this.bucketIndex(event.time)].push(event);
  }

  private collectBuckets(
    from: number,
    to: number,
    limit: number,
    due: Array<TimerEvent<T>>,
  ): void {
    if (from > to) {
      return;
    }
    for (let index = from; index <= to; index++) {
      const bucket = this._buckets[index];
      const kept: Array<TimerEvent<T>> = [];
      for (const event of bucket) {
        if (event.cancelled) {
          continue;
        }
        if (event.time <= limit) {
          due.push(event);
          this._eventsById.delete(event.id);
          this._size--;
        } else {
          kept.push(event);
        }
      }
      this._buckets[index] = kept;
    }
  }

  private collectActive(): Array<TimerEvent<T>> {
    const events: Array<TimerEvent<T>> = [];
    for (const bucket of this._buckets) {
      for (const event of bucket) {
        if (!event.cancelled) {
          events.push(event);
        }
      }
    }
    for (const event of this._overflow.toArray()) {
      if (!event.cancelled) {
        events.push(event);
      }
    }
    return events;
  }

  private grow(): void {
    if (this._bucketCount >= 0x100000) {
      return;
    }
    const events = this.collectActive();
    this._bucketCount *= 2;
    this._buckets = this.createBuckets();
    this._overflow = new BinaryHeap<TimerEvent<T>>(compareEvents);
    for (const event of events) {
      this.place(event);
    }
    this._cursor = this.bucketIndex(this._now);
  }

  private restore(
    events: Array<{ id: number; time: number; seq: number; value: unknown }>,
  ): void {
    this._buckets = this.createBuckets();
    this._overflow = new BinaryHeap<TimerEvent<T>>(compareEvents);
    this._eventsById = new Map();
    this._size = 0;
    this._cursor = this.bucketIndex(this._now);
    for (const item of events) {
      if (item.time < this._now) {
        throw new TypeError("serialized event is before now");
      }
      const event: TimerEvent<T> = {
        id: item.id,
        time: item.time,
        seq: item.seq,
        tick: 0,
        value: item.value as T,
        cancelled: false,
      };
      this._eventsById.set(event.id, event);
      this._size++;
      this.place(event);
      if (event.id >= this._nextId) {
        this._nextId = event.id + 1;
      }
      if (event.seq >= this._seq) {
        this._seq = event.seq + 1;
      }
    }
  }
}

const FAST_FORWARD_TICKS = 1_000_000;

/**
 * Hierarchical timing wheel (Varghese and Lauck). Time is quantized into ticks of `tickSize`;
 * level-0 has `slots` buckets of one tick each, level-1 has `slots` buckets of `slots` ticks,
 * and so on. A scheduled event is placed at the coarsest level that still cascades it before it is
 * due; each tick cascades the buckets that turn over and drains the level-0 slot. That makes
 * schedule and per-tick advance O(1) amortized, with O(levels) work per cascade. Levels are added
 * on demand for far-future events, and a very large jump falls back to a single O(n log n) rebuild.
 *
 * With the default `tickSize = 1`, `advance(t)` returns exactly the events with time <= t. With a
 * coarser tick, events fire on tick boundaries at or after their time, and `advance(t)` delivers
 * every event whose tick boundary has been reached (all of which have time <= t). Ties are
 * delivered by scheduling order.
 */
export class TimingWheel<T> extends ContainerBase<T> implements TimerQueue<T> {
  readonly tickSize: number;
  readonly slots: number;
  private _levels: number;
  private _buckets: Array<Array<Array<TimerEvent<T>>>>;
  private _eventsById = new Map<number, TimerEvent<T>>();
  private _now: number;
  private _currentTick: number;
  private _nextId = 1;
  private _seq = 0;
  private _cachedPeek: number | null | undefined = undefined;

  constructor(options: TimingWheelOptions = {}) {
    super();
    this.tickSize = requirePositive(options.tickSize ?? 1, "tickSize");
    const slots = options.slots ?? 64;
    assertInteger(slots, "slots");
    if (slots < 2 || slots > 0x100000) {
      throw new RangeError("slots must be in [2, 1048576]");
    }
    this.slots = slots;
    const levels = options.levels ?? 4;
    assertInteger(levels, "levels");
    if (levels < 1 || levels > 64) {
      throw new RangeError("levels must be in [1, 64]");
    }
    this._levels = levels;
    this._now = requireNow(options.now ?? 0);
    this._currentTick = Math.floor(this._now / this.tickSize);
    this._buckets = this.createBuckets();
  }

  /** O(1): current simulation time. */
  get now(): number {
    return this._now;
  }

  /** O(1) plus level growth: places the event at the coarsest wheel that still cascades it. */
  schedule(time: number, value: T): number {
    requireTime(time);
    assertDefined(value);
    if (time < this._now) {
      throw new RangeError("cannot schedule an event before now");
    }
    const event: TimerEvent<T> = {
      id: this._nextId++,
      time,
      seq: this._seq++,
      tick: 0,
      value,
      cancelled: false,
    };
    eventTick(event, this.tickSize);
    this._eventsById.set(event.id, event);
    this._size++;
    this.place(event);
    this._cachedPeek = undefined;
    this.touch();
    return event.id;
  }

  /** O(1): marks the event cancelled and removes it from the id index. */
  cancel(id: number): boolean {
    assertInteger(id, "id");
    const event = this._eventsById.get(id);
    if (event === undefined) {
      return false;
    }
    event.cancelled = true;
    this._eventsById.delete(id);
    this._size--;
    this._cachedPeek = undefined;
    this.touch();
    return true;
  }

  /**
   * O(ticks + cascades + k log k) for k due events: drains the current slot, advances one tick at a
   * time, cascades coarser wheels, and returns due events in time order. Jumps of more than a
   * million ticks rebuild once instead.
   */
  advance(time: number): T[] {
    requireTime(time);
    if (time < this._now) {
      throw new RangeError("cannot advance backwards");
    }
    this._cachedPeek = undefined;
    const targetTick = Math.floor(time / this.tickSize);
    if (targetTick - this._currentTick > FAST_FORWARD_TICKS) {
      return this.fastForward(time, targetTick);
    }
    const due: Array<TimerEvent<T>> = [];
    this.drainSlot(this._currentTick, due);
    for (let tick = this._currentTick + 1; tick <= targetTick; tick++) {
      this.advanceTick(tick, due);
    }
    this._now = time;
    due.sort(compareEvents);
    this.touch();
    return due.map((event) => event.value);
  }

  /** O(1) amortized: earliest scheduled time; the first call after a mutation scans the index. */
  peekTime(): number | undefined {
    if (this._cachedPeek === undefined) {
      let minimum: number | null = null;
      for (const event of this._eventsById.values()) {
        if (minimum === null || event.time < minimum) {
          minimum = event.time;
        }
      }
      this._cachedPeek = minimum;
    }
    return this._cachedPeek === null ? undefined : this._cachedPeek;
  }

  /** O(n log n): active events in non-decreasing time order. */
  override toArray(): T[] {
    const events = [...this._eventsById.values()].sort(compareEvents);
    return events.map((event) => event.value);
  }

  /** O(n log n) up front: snapshot iterator in time order. */
  override [Symbol.iterator](): IterableIterator<T> {
    return this.snapshotIterator(this.toArray());
  }

  /** O(n): drops every event; `now` and the wheel geometry are retained. */
  override clear(): void {
    this._buckets = this.createBuckets();
    this._eventsById = new Map();
    this._size = 0;
    this._cachedPeek = undefined;
    this.touch();
  }

  /** O(n + slots·levels): validates wheel placement, ticks, ids, and counts. */
  override validate(): true | string {
    if (this._buckets.length !== this._levels) {
      return "level count does not match the wheel";
    }
    for (const level of this._buckets) {
      if (level.length !== this.slots) {
        return "level slot count does not match slots";
      }
    }
    if (this._currentTick !== Math.floor(this._now / this.tickSize)) {
      return "current tick does not match now";
    }
    if (this._eventsById.size !== this._size) {
      return "id index size does not match size";
    }
    const seen = new Set<TimerEvent<T>>();
    let active = 0;
    for (let level = 0; level < this._buckets.length; level++) {
      for (let slot = 0; slot < this.slots; slot++) {
        for (const event of this._buckets[level][slot]) {
          if (event.cancelled) {
            continue;
          }
          if (seen.has(event)) {
            return "event appears in more than one slot";
          }
          seen.add(event);
          active++;
          if (event.value === undefined) {
            return "event value is undefined";
          }
          if (event.time < this._now) {
            return "active event is before now";
          }
          if (event.tick !== Math.ceil(event.time / this.tickSize)) {
            return "event tick does not match its time";
          }
          if (event.tick < this._currentTick) {
            return "active event is in the past";
          }
          if (this.slotOf(event.tick, level) !== slot) {
            return "event is in the wrong wheel slot";
          }
          if (level < this.requiredLevel(event.tick)) {
            return "event is in too fine a wheel level";
          }
          if (this._eventsById.get(event.id) !== event) {
            return "wheel event is missing from the id index";
          }
        }
      }
    }
    if (active !== this._size) {
      return `size ${this._size} does not match active event count ${active}`;
    }
    for (const [id, event] of this._eventsById) {
      if (event.id !== id || event.cancelled || !seen.has(event)) {
        return "id index contains a stale or cancelled event";
      }
    }
    return true;
  }

  /** O(n log n): serializes active events and the wheel geometry. */
  override serialize(): string {
    const events = [...this._eventsById.values()].sort(compareEvents);
    return serializeEvents("TimingWheel", events, {
      now: this._now,
      tickSize: this.tickSize,
      slots: this.slots,
      levels: this._levels,
    });
  }

  /** O(n): restores geometry, events, ids, and scheduling order. */
  static deserialize<T>(
    json: unknown,
    options: TimingWheelOptions = {},
  ): TimingWheel<T> {
    const { record, events } = parseEvents(json, "TimingWheel");
    const queue = new TimingWheel<T>({
      tickSize: options.tickSize ?? readNumber(record, "tickSize"),
      slots: options.slots ?? readInteger(record, "slots"),
      levels: options.levels ?? readInteger(record, "levels"),
      now: options.now ?? readNumber(record, "now"),
    });
    queue.restore(events);
    if (queue.validate() !== true) {
      throw new TypeError(`Invalid TimingWheel payload: ${queue.validate()}`);
    }
    return queue;
  }

  private createBuckets(): Array<Array<Array<TimerEvent<T>>>> {
    return Array.from({ length: this._levels }, () =>
      Array.from({ length: this.slots }, () => []),
    );
  }

  private place(event: TimerEvent<T>): void {
    const delay = event.tick - this._currentTick;
    if (delay <= 0) {
      this._buckets[0][this.slotOf(this._currentTick, 0)].push(event);
      return;
    }
    let level = 0;
    let capacity = this.slots;
    while (delay >= capacity) {
      level++;
      capacity *= this.slots;
      if (!Number.isFinite(capacity)) {
        throw new RangeError("event is too far in the future for the wheel geometry");
      }
    }
    while (level >= this._levels) {
      this._buckets.push(Array.from({ length: this.slots }, () => []));
      this._levels++;
    }
    this._buckets[level][this.slotOf(event.tick, level)].push(event);
  }

  private slotOf(tick: number, level: number): number {
    const period = Math.pow(this.slots, level);
    return Math.floor(tick / period) % this.slots;
  }

  private advanceTick(tick: number, due: Array<TimerEvent<T>>): void {
    this._currentTick = tick;
    for (let level = this._levels - 1; level >= 1; level--) {
      const period = Math.pow(this.slots, level);
      if (tick % period !== 0) {
        continue;
      }
      const slot = this.slotOf(tick, level);
      const bucket = this._buckets[level][slot];
      this._buckets[level][slot] = [];
      for (const event of bucket) {
        if (!event.cancelled) {
          this.place(event);
        }
      }
    }
    this.drainSlot(tick, due);
  }

  private drainSlot(tick: number, due: Array<TimerEvent<T>>): void {
    const slot = this.slotOf(tick, 0);
    const bucket = this._buckets[0][slot];
    this._buckets[0][slot] = [];
    for (const event of bucket) {
      if (event.cancelled) {
        continue;
      }
      due.push(event);
      this._eventsById.delete(event.id);
      this._size--;
    }
  }

  private requiredLevel(tick: number): number {
    const delay = tick - this._currentTick;
    if (delay <= 0) {
      return 0;
    }
    let level = 0;
    let capacity = this.slots;
    while (delay >= capacity) {
      level++;
      capacity *= this.slots;
    }
    return level;
  }

  private fastForward(time: number, targetTick: number): T[] {
    const due: Array<TimerEvent<T>> = [];
    const future: Array<TimerEvent<T>> = [];
    for (const event of this._eventsById.values()) {
      if (event.time <= time) {
        due.push(event);
      } else {
        future.push(event);
      }
    }
    for (const event of due) {
      this._eventsById.delete(event.id);
      this._size--;
    }
    this._currentTick = targetTick;
    this._now = time;
    this._buckets = this.createBuckets();
    for (const event of future) {
      this.place(event);
    }
    due.sort(compareEvents);
    this.touch();
    return due.map((event) => event.value);
  }

  private restore(
    events: Array<{ id: number; time: number; seq: number; value: unknown }>,
  ): void {
    this._buckets = this.createBuckets();
    this._eventsById = new Map();
    this._size = 0;
    for (const item of events) {
      if (item.time < this._now) {
        throw new TypeError("serialized event is before now");
      }
      const event: TimerEvent<T> = {
        id: item.id,
        time: item.time,
        seq: item.seq,
        tick: 0,
        value: item.value as T,
        cancelled: false,
      };
      eventTick(event, this.tickSize);
      this._eventsById.set(event.id, event);
      this._size++;
      this.place(event);
      if (event.id >= this._nextId) {
        this._nextId = event.id + 1;
      }
      if (event.seq >= this._seq) {
        this._seq = event.seq + 1;
      }
    }
  }
}

function eventTick<T>(event: TimerEvent<T>, tickSize: number): void {
  const tick = Math.ceil(event.time / tickSize);
  if (!Number.isFinite(tick) || tick < 0) {
    throw new RangeError("event time is outside the representable tick range");
  }
  event.tick = tick;
}
