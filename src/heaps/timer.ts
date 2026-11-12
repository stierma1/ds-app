import {
  assertDefined,
  assertInteger,
  ContainerBase,
  readInteger,
  readNumber,
  readOptionalInteger,
} from "../core/index.ts";
import {
  parseEvents,
  restoreFromPayload,
  serializeEvents,
} from "./serialization.ts";
import type { SerializedEvent } from "./serialization.ts";
import type { CalendarQueueOptions, TimerQueue, TimingWheelOptions } from "./types.ts";

interface TimerEvent<T> {
  id: number;
  time: number;
  seq: number;
  /** Tick index used by TimingWheel; CalendarQueue leaves it at 0. */
  tick: number;
  value: T;
  /** TimingWheel only: the event is no longer pending (cancelled or delivered). */
  cancelled: boolean;
  /** TimingWheel only: the wheel level, slot, and position in the slot that hold the event. */
  level: number;
  slot: number;
  index: number;
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
 * O(n) payload checks shared by both timer queues: ids are unique, and the restored next-id counter
 * is the serialized `nextId` when present (it must exceed every live id) or, for payloads written
 * before the counter was serialized, one more than the largest live id.
 */
function readIdCounters(
  record: Record<string, unknown>,
  events: readonly SerializedEvent[],
): { nextId: number; nextSeq: number } {
  const ids = new Set<number>();
  let maxId = 0;
  let maxSeq = -1;
  for (const event of events) {
    if (ids.has(event.id)) {
      throw new TypeError(`duplicate event id ${event.id}`);
    }
    ids.add(event.id);
    maxId = Math.max(maxId, event.id);
    maxSeq = Math.max(maxSeq, event.seq);
  }
  const stored = readOptionalInteger(record, "nextId");
  if (stored !== undefined && stored <= maxId) {
    throw new TypeError("nextId must be greater than every event id");
  }
  return { nextId: stored ?? maxId + 1, nextSeq: maxSeq + 1 };
}

/** Largest virtual bucket number; keeps `vb + bucketCount` an exact integer. */
const MAX_VIRTUAL_BUCKET = 2 ** 52;
const MAX_CALENDAR_BUCKETS = 0x100000;
/** Number of earliest events Brown's resize samples to estimate the event separation. */
const RESIZE_SAMPLE = 25;

/**
 * Brown's calendar queue. An event at time t lives in "day" `floor(t / bucketWidth)`, stored in
 * bucket `day mod bucketCount`; one pass over the buckets is a "year". Each bucket is sorted by
 * (time, scheduling order). Finding the next event scans forward from the current day and accepts
 * a bucket head only if it belongs to the day being visited; after a full year without one, a direct
 * search over the bucket heads jumps to the earliest event.
 *
 * Resizing follows Brown: when the event count exceeds twice the bucket count the calendar doubles,
 * and when it drops below half it halves. Either way the new bucket width is three times the mean
 * separation of the earliest events (ignoring separations more than twice the overall mean), and
 * every event is re-bucketed. That keeps buckets O(1) long under a stable event-time distribution,
 * so schedule, cancel, and each delivered event are O(1) amortized; far-future events just occupy
 * their own days rather than lengthening the near buckets.
 *
 * `peekTime` is O(1): the earliest event is tracked on schedule and recomputed by the next-event
 * search when it is delivered or cancelled. Ties are delivered by scheduling order. `advance(t)` sets
 * `now = t` and returns every event with time <= t in non-decreasing time order.
 */
export class CalendarQueue<T> extends ContainerBase<T> implements TimerQueue<T> {
  private _bucketCount: number;
  private _bucketWidth: number;
  private _buckets: Array<Array<TimerEvent<T>>>;
  private _eventsById = new Map<number, TimerEvent<T>>();
  private _min: TimerEvent<T> | null = null;
  private _now: number;
  private _nextId = 1;
  private _seq = 0;

  constructor(options: CalendarQueueOptions = {}) {
    super();
    const bucketCount = options.bucketCount ?? 32;
    assertInteger(bucketCount, "bucketCount");
    if (bucketCount < 1 || bucketCount > MAX_CALENDAR_BUCKETS) {
      throw new RangeError("bucketCount must be in [1, 1048576]");
    }
    this._bucketCount = bucketCount;
    this._bucketWidth = requirePositive(options.bucketWidth ?? 1, "bucketWidth");
    this._now = requireNow(options.now ?? 0);
    this._buckets = this.createBuckets(bucketCount);
  }

  /** O(1): the current simulation time. */
  get now(): number {
    return this._now;
  }

  /** O(1): current number of buckets (grows and shrinks with the event count). */
  get bucketCount(): number {
    return this._bucketCount;
  }

  /** O(1): current bucket width (re-estimated from event separations on every resize). */
  get bucketWidth(): number {
    return this._bucketWidth;
  }

  /** O(1) amortized: sorted insert into the event's day bucket, plus an occasional resize. */
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
      level: 0,
      slot: 0,
      index: 0,
    };
    this._eventsById.set(event.id, event);
    this._size++;
    this.insertEvent(event);
    if (this._min === null || compareEvents(event, this._min) < 0) {
      this._min = event;
    }
    if (this._size > this._bucketCount * 2 && this._bucketCount < MAX_CALENDAR_BUCKETS) {
      this.resize(this._bucketCount * 2);
    }
    this.touch();
    return event.id;
  }

  /**
   * O(1) amortized: removes the event from its bucket. Cancelling the earliest event also runs the
   * next-event search (the same cost as delivering it).
   */
  cancel(id: number): boolean {
    assertInteger(id, "id");
    const event = this._eventsById.get(id);
    if (event === undefined) {
      return false;
    }
    this.removeEvent(event);
    this._eventsById.delete(id);
    this._size--;
    if (event === this._min) {
      this._min = this.findNext(event.time);
    }
    this.maybeShrink();
    this.touch();
    return true;
  }

  /**
   * O(1) amortized per delivered event under a stable event-time distribution (O(n) worst case for
   * a direct search): sets `now = time` and returns the due events in (time, scheduling) order.
   */
  advance(time: number): T[] {
    requireTime(time);
    if (time < this._now) {
      throw new RangeError("cannot advance backwards");
    }
    const values: T[] = [];
    while (this._min !== null && this._min.time <= time) {
      const event = this._min;
      this.removeEvent(event);
      this._eventsById.delete(event.id);
      this._size--;
      values.push(event.value);
      this._min = this.findNext(event.time);
    }
    this._now = time;
    this.maybeShrink();
    this.touch();
    return values;
  }

  /** O(1): earliest scheduled time. */
  peekTime(): number | undefined {
    return this._min === null ? undefined : this._min.time;
  }

  /** O(n log n): active events in non-decreasing time order. */
  override toArray(): T[] {
    return this.sortedEvents().map((event) => event.value);
  }

  /** O(n log n) up front: snapshot iterator in time order. */
  override [Symbol.iterator](): IterableIterator<T> {
    return this.snapshotIterator(this.toArray());
  }

  /** O(n + buckets): drops every event; `now` and the geometry are retained. */
  override clear(): void {
    this._buckets = this.createBuckets(this._bucketCount);
    this._eventsById = new Map();
    this._min = null;
    this._size = 0;
    this.touch();
  }

  /** O(n + buckets): validates geometry, bucket placement and order, ids, counts, and the minimum. */
  override validate(): true | string {
    if (
      !Number.isInteger(this._bucketCount) ||
      this._bucketCount < 1 ||
      this._bucketCount > MAX_CALENDAR_BUCKETS
    ) {
      return "bucketCount is out of range";
    }
    if (this._buckets.length !== this._bucketCount) {
      return "bucket array length does not match bucketCount";
    }
    if (!(this._bucketWidth > 0 && Number.isFinite(this._bucketWidth))) {
      return "bucketWidth must be positive and finite";
    }
    if (this._eventsById.size !== this._size) {
      return "id index size does not match size";
    }
    const seen = new Set<TimerEvent<T>>();
    let minimum: TimerEvent<T> | null = null;
    for (let index = 0; index < this._buckets.length; index++) {
      const bucket = this._buckets[index];
      for (let position = 0; position < bucket.length; position++) {
        const event = bucket[position];
        if (seen.has(event)) {
          return "event appears more than once";
        }
        seen.add(event);
        if (event.value === undefined) {
          return "event value is undefined";
        }
        if (event.time < this._now) {
          return "active event is before now";
        }
        if (this._eventsById.get(event.id) !== event) {
          return "bucket event is missing from the id index";
        }
        if (event.id >= this._nextId) {
          return "event id is not below the next id";
        }
        if (this.bucketOf(event.time) !== index) {
          return "event is in the wrong bucket";
        }
        if (position > 0 && compareEvents(bucket[position - 1], event) >= 0) {
          return "bucket is not sorted by time and scheduling order";
        }
      }
      if (bucket.length > 0 && (minimum === null || compareEvents(bucket[0], minimum) < 0)) {
        minimum = bucket[0];
      }
    }
    if (seen.size !== this._size) {
      return `size ${this._size} does not match active event count ${seen.size}`;
    }
    if (this._min !== minimum) {
      return "tracked minimum is not the earliest event";
    }
    return true;
  }

  /** O(n log n): serializes active events in time order with the geometry and the id counter. */
  override serialize(): string {
    return serializeEvents("CalendarQueue", this.sortedEvents(), {
      now: this._now,
      bucketCount: this._bucketCount,
      bucketWidth: this._bucketWidth,
      nextId: this._nextId,
    });
  }

  /**
   * O(n) expected: restores the geometry, events, ids, the next-id counter (absent in older
   * payloads, which fall back to one more than the largest id), and scheduling order. Malformed
   * payloads throw TypeError.
   */
  static deserialize<T>(
    json: unknown,
    options: CalendarQueueOptions = {},
  ): CalendarQueue<T> {
    const { record, events } = parseEvents(json, "CalendarQueue");
    const bucketCount = options.bucketCount ?? readInteger(record, "bucketCount");
    const bucketWidth = options.bucketWidth ?? readNumber(record, "bucketWidth");
    const now = options.now ?? readNumber(record, "now");
    const counters = readIdCounters(record, events);
    return restoreFromPayload("CalendarQueue", () => {
      const queue = new CalendarQueue<T>({ bucketCount, bucketWidth, now });
      queue.restore(events, counters.nextId, counters.nextSeq);
      const valid = queue.validate();
      if (valid !== true) {
        throw new TypeError(`Invalid CalendarQueue payload: ${valid}`);
      }
      return queue;
    });
  }

  private createBuckets(count: number): Array<Array<TimerEvent<T>>> {
    return Array.from({ length: count }, () => []);
  }

  private sortedEvents(): Array<TimerEvent<T>> {
    return [...this._eventsById.values()].sort(compareEvents);
  }

  /** O(1): the event's day number, clamped so that day arithmetic stays exact. */
  private day(time: number): number {
    return Math.min(MAX_VIRTUAL_BUCKET, Math.floor(time / this._bucketWidth));
  }

  private bucketOf(time: number): number {
    return this.day(time) % this._bucketCount;
  }

  /** O(log b + b) for a bucket of length b: binary search for the slot after equal events. */
  private insertEvent(event: TimerEvent<T>): void {
    const bucket = this._buckets[this.bucketOf(event.time)];
    let low = 0;
    let high = bucket.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (compareEvents(bucket[middle], event) < 0) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    if (low === bucket.length) {
      bucket.push(event);
    } else {
      bucket.splice(low, 0, event);
    }
  }

  /** O(log b + b): (time, seq) is unique, so a binary search finds the event. */
  private removeEvent(event: TimerEvent<T>): void {
    const bucket = this._buckets[this.bucketOf(event.time)];
    let low = 0;
    let high = bucket.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (compareEvents(bucket[middle], event) < 0) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    if (bucket[low] !== event) {
      throw new Error("calendar queue invariant violated: event is not in its bucket");
    }
    if (low === 0) {
      bucket.shift();
    } else {
      bucket.splice(low, 1);
    }
  }

  /**
   * Brown's dequeue search for the earliest event, given that every event has time >= `from`.
   * Visits days from day(from) for one year and returns the first bucket head that belongs to the
   * day being visited; that head is the global minimum because every earlier day was empty. After a
   * year with no hit, falls back to an O(buckets) direct search over the heads.
   */
  private findNext(from: number): TimerEvent<T> | null {
    if (this._size === 0) {
      return null;
    }
    const start = this.day(from);
    for (let offset = 0; offset < this._bucketCount; offset++) {
      const day = start + offset;
      const head = this._buckets[day % this._bucketCount][0];
      if (head !== undefined && this.day(head.time) <= day) {
        return head;
      }
    }
    let best: TimerEvent<T> | null = null;
    for (const bucket of this._buckets) {
      const head = bucket[0];
      if (head !== undefined && (best === null || compareEvents(head, best) < 0)) {
        best = head;
      }
    }
    return best;
  }

  /**
   * Brown's shrink threshold: below half as many events as buckets, halve the bucket count until
   * it no longer exceeds the event count, so the next resize is Θ(bucketCount) operations away.
   */
  private maybeShrink(): void {
    if (this._bucketCount > 1 && this._size < this._bucketCount / 2) {
      let count = this._bucketCount;
      while (count > 1 && count > this._size) {
        count = Math.floor(count / 2);
      }
      this.resize(count);
    }
  }

  /**
   * O(n) expected: Brown's resize. Picks the new width from the separations of the earliest
   * RESIZE_SAMPLE events and re-buckets every event. The hysteresis between the grow (2x) and shrink
   * (1/2) thresholds leaves Θ(bucketCount) operations between resizes, so the cost is amortized.
   */
  private resize(bucketCount: number): void {
    const events = [...this._eventsById.values()];
    const width = this.sampleWidth(events);
    this._bucketCount = bucketCount;
    this._bucketWidth = width;
    this._buckets = this.createBuckets(bucketCount);
    for (const event of events) {
      this.insertEvent(event);
    }
  }

  /**
   * O(n log RESIZE_SAMPLE): three times the mean separation of the earliest events, recomputed
   * without separations above twice the first mean (Brown). Keeps the current width when the sample
   * has no positive separation.
   */
  private sampleWidth(events: ReadonlyArray<TimerEvent<T>>): number {
    const sample = earliestTimes(events, RESIZE_SAMPLE);
    if (sample.length < 2) {
      return this._bucketWidth;
    }
    const total = sample[sample.length - 1] - sample[0];
    const mean = total / (sample.length - 1);
    let sum = 0;
    let count = 0;
    for (let index = 1; index < sample.length; index++) {
      const gap = sample[index] - sample[index - 1];
      if (gap <= 2 * mean) {
        sum += gap;
        count++;
      }
    }
    const width = count === 0 ? 0 : (3 * sum) / count;
    return width > 0 && Number.isFinite(width) ? width : this._bucketWidth;
  }

  private restore(events: readonly SerializedEvent[], nextId: number, nextSeq: number): void {
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
        level: 0,
        slot: 0,
        index: 0,
      };
      this._eventsById.set(event.id, event);
      this._size++;
      this.insertEvent(event);
      if (this._min === null || compareEvents(event, this._min) < 0) {
        this._min = event;
      }
    }
    this._nextId = nextId;
    this._seq = nextSeq;
  }
}

/**
 * O(n log k): the k smallest event times in ascending order, via a bounded max-heap, so a resize
 * stays linear in the event count.
 */
function earliestTimes<T>(events: ReadonlyArray<TimerEvent<T>>, k: number): number[] {
  const heap: number[] = [];
  const siftDown = (): void => {
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= heap.length) {
        return;
      }
      const right = left + 1;
      const child = right < heap.length && heap[right] > heap[left] ? right : left;
      if (heap[child] <= heap[index]) {
        return;
      }
      [heap[index], heap[child]] = [heap[child], heap[index]];
      index = child;
    }
  };
  for (const event of events) {
    const time = event.time;
    if (heap.length < k) {
      heap.push(time);
      let index = heap.length - 1;
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (heap[parent] >= heap[index]) {
          break;
        }
        [heap[index], heap[parent]] = [heap[parent], heap[index]];
        index = parent;
      }
    } else if (time < heap[0]) {
      heap[0] = time;
      siftDown();
    }
  }
  return heap.sort((a, b) => a - b);
}

const FAST_FORWARD_TICKS = 1_000_000;

/** O(words): index of the first set bit in [from, size), or -1. */
function firstSetBit(bits: Uint32Array, from: number, size: number): number {
  let word = from >>> 5;
  if (from >= size) {
    return -1;
  }
  let current = bits[word] & (~0 << (from & 31));
  while (true) {
    if (current !== 0) {
      const index = (word << 5) + (31 - Math.clz32(current & -current));
      return index < size ? index : -1;
    }
    word++;
    if (word >= bits.length) {
      return -1;
    }
    current = bits[word];
  }
}

interface WheelLevel<T> {
  slots: Array<Array<TimerEvent<T>>>;
  /** Earliest event of each slot, or null when the slot is empty. */
  minimum: Array<TimerEvent<T> | null>;
  /** Bit s is set when slot s holds at least one event. */
  occupied: Uint32Array;
}

/**
 * Hierarchical timing wheel (Varghese and Lauck). Time is quantized into ticks of `tickSize`;
 * level-0 has `slots` buckets of one tick each, level-1 has `slots` buckets of `slots` ticks,
 * and so on. A scheduled event is placed at the coarsest level that still cascades it before it is
 * due; each tick cascades the buckets that turn over and drains the level-0 slot. That makes
 * schedule and per-tick advance O(1) amortized, with O(levels) work per cascade. Levels are added
 * on demand for far-future events, and a very large jump falls back to a single O(n log n) rebuild.
 *
 * With `tickSize <= 1` (the default is 1) there is no quantization: an event lives in the tick that
 * contains its time, and `advance(t)` returns exactly the events with time <= t, holding back the
 * later events of the tick that contains t. With `tickSize > 1`, events are quantized to the tick
 * boundary at or after their time and `advance(t)` delivers every event whose boundary has been
 * reached, so an event can stay pending while `now` is already past its time. The stepped and
 * fast-forward paths apply the same rule. Ties are delivered by scheduling order.
 *
 * `peekTime` is O(1): the earliest pending event is cached. Every slot keeps its earliest event and
 * every level an occupancy bitmap; slots of one level cover consecutive time windows in cyclic
 * order from the current position, so the earliest event is the minimum, over the levels, of each
 * level's first occupied slot. Recomputing it costs O(levels · ⌈slots/32⌉) word scans and is only
 * needed when the cached event is delivered or cancelled. Events are removed from their slot
 * physically (O(1) swap-removal); cancelling a slot's earliest event rescans that slot.
 */
export class TimingWheel<T> extends ContainerBase<T> implements TimerQueue<T> {
  readonly tickSize: number;
  readonly slots: number;
  private _wheel: Array<WheelLevel<T>> = [];
  private _eventsById = new Map<number, TimerEvent<T>>();
  private _earliest: TimerEvent<T> | null = null;
  private readonly _quantized: boolean;
  private readonly _initialLevels: number;
  private _now: number;
  private _currentTick: number;
  private _nextId = 1;
  private _seq = 0;

  constructor(options: TimingWheelOptions = {}) {
    super();
    this.tickSize = requirePositive(options.tickSize ?? 1, "tickSize");
    this._quantized = this.tickSize > 1;
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
    this._initialLevels = levels;
    this._now = requireNow(options.now ?? 0);
    this._currentTick = Math.floor(this._now / this.tickSize);
    this.resetWheel(levels);
  }

  /** O(1): current simulation time. */
  get now(): number {
    return this._now;
  }

  /** O(1): current number of wheel levels (grows for far-future events). */
  get levels(): number {
    return this._wheel.length;
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
      tick: this.tickOf(time),
      value,
      cancelled: false,
      level: 0,
      slot: 0,
      index: 0,
    };
    this._eventsById.set(event.id, event);
    this._size++;
    this.place(event);
    if (this._earliest === null || compareEvents(event, this._earliest) < 0) {
      this._earliest = event;
    }
    this.touch();
    return event.id;
  }

  /**
   * O(1) to unlink the event from its slot. Cancelling a slot's earliest event rescans that slot
   * (O(slot size)), and cancelling the overall earliest event recomputes it in
   * O(levels · ⌈slots/32⌉).
   */
  cancel(id: number): boolean {
    assertInteger(id, "id");
    const event = this._eventsById.get(id);
    if (event === undefined) {
      return false;
    }
    event.cancelled = true;
    this.unlink(event);
    this._eventsById.delete(id);
    this._size--;
    if (event === this._earliest) {
      this._earliest = this.findEarliest();
    }
    this.touch();
    return true;
  }

  /**
   * O(ticks + cascades + k log k) for k due events: drains the current slot, advances one tick at a
   * time, cascades coarser wheels, and returns due events in time order. Jumps of more than a
   * million ticks rebuild once instead. If the earliest event was delivered, the next one is found
   * in O(levels · ⌈slots/32⌉) once per call.
   */
  advance(time: number): T[] {
    requireTime(time);
    if (time < this._now) {
      throw new RangeError("cannot advance backwards");
    }
    const targetTick = Math.floor(time / this.tickSize);
    if (targetTick - this._currentTick > FAST_FORWARD_TICKS) {
      return this.fastForward(time, targetTick);
    }
    // Without quantization the tick containing `time` is only drained up to `time`.
    const limit = this._quantized ? Infinity : time;
    const due: Array<TimerEvent<T>> = [];
    this.drainSlot(this._currentTick, due, targetTick === this._currentTick ? limit : Infinity);
    for (let tick = this._currentTick + 1; tick <= targetTick; tick++) {
      this.advanceTick(tick, due, tick === targetTick ? limit : Infinity);
    }
    this._now = time;
    return this.deliver(due);
  }

  /** O(1): earliest scheduled time. */
  peekTime(): number | undefined {
    return this._earliest === null ? undefined : this._earliest.time;
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

  /** O(n + slots·levels): drops every event; `now` and the wheel geometry are retained. */
  override clear(): void {
    this.resetWheel(this._wheel.length);
    this._eventsById = new Map();
    this._earliest = null;
    this._size = 0;
    this.touch();
  }

  /** O(n + slots·levels): validates placement, slot bookkeeping, ticks, ids, and the earliest event. */
  override validate(): true | string {
    if (this._wheel.length < 1 || this._wheel.length > 64) {
      return "level count is out of range";
    }
    if (this._currentTick !== Math.floor(this._now / this.tickSize)) {
      return "current tick does not match now";
    }
    if (this._eventsById.size !== this._size) {
      return "id index size does not match size";
    }
    const seen = new Set<TimerEvent<T>>();
    let earliest: TimerEvent<T> | null = null;
    for (let level = 0; level < this._wheel.length; level++) {
      const wheel = this._wheel[level];
      if (wheel.slots.length !== this.slots || wheel.minimum.length !== this.slots) {
        return "level slot count does not match slots";
      }
      for (let slot = 0; slot < this.slots; slot++) {
        const bucket = wheel.slots[slot];
        const occupied = (wheel.occupied[slot >>> 5] & (1 << (slot & 31))) !== 0;
        if (occupied !== bucket.length > 0) {
          return `occupancy bit of level ${level} slot ${slot} is wrong`;
        }
        let minimum: TimerEvent<T> | null = null;
        for (let index = 0; index < bucket.length; index++) {
          const event = bucket[index];
          if (seen.has(event)) {
            return "event appears in more than one slot";
          }
          seen.add(event);
          if (event.cancelled || event.value === undefined) {
            return "slot holds a cancelled or undefined event";
          }
          if (event.level !== level || event.slot !== slot || event.index !== index) {
            return "event slot bookkeeping is inconsistent";
          }
          if (event.tick !== this.tickOf(event.time)) {
            return "event tick does not match its time";
          }
          if (!this.isPendingState(event.time, event.tick)) {
            return "active event should already have been delivered";
          }
          if (event.id >= this._nextId) {
            return "event id is not below the next id";
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
          if (minimum === null || compareEvents(event, minimum) < 0) {
            minimum = event;
          }
        }
        if (wheel.minimum[slot] !== minimum) {
          return `level ${level} slot ${slot} tracks the wrong earliest event`;
        }
        if (minimum !== null && (earliest === null || compareEvents(minimum, earliest) < 0)) {
          earliest = minimum;
        }
      }
    }
    if (seen.size !== this._size) {
      return `size ${this._size} does not match active event count ${seen.size}`;
    }
    if (this._earliest !== earliest) {
      return "cached earliest event is not the earliest pending event";
    }
    if (this.findEarliest() !== earliest) {
      return "level scan does not find the earliest pending event";
    }
    return true;
  }

  /** O(n log n): serializes active events, the wheel geometry, and the id counter. */
  override serialize(): string {
    const events = [...this._eventsById.values()].sort(compareEvents);
    return serializeEvents("TimingWheel", events, {
      now: this._now,
      tickSize: this.tickSize,
      slots: this.slots,
      levels: this._wheel.length,
      nextId: this._nextId,
    });
  }

  /**
   * O(n): restores geometry, events (including quantized events whose time is before `now` but
   * whose tick boundary is not reached yet), ids, the next-id counter (absent in older payloads,
   * which fall back to one more than the largest id), and scheduling order. Malformed payloads
   * throw TypeError.
   */
  static deserialize<T>(
    json: unknown,
    options: TimingWheelOptions = {},
  ): TimingWheel<T> {
    const { record, events } = parseEvents(json, "TimingWheel");
    const geometry: TimingWheelOptions = {
      tickSize: options.tickSize ?? readNumber(record, "tickSize"),
      slots: options.slots ?? readInteger(record, "slots"),
      levels: options.levels ?? readInteger(record, "levels"),
      now: options.now ?? readNumber(record, "now"),
    };
    const counters = readIdCounters(record, events);
    return restoreFromPayload("TimingWheel", () => {
      const queue = new TimingWheel<T>(geometry);
      queue.restore(events, counters.nextId, counters.nextSeq);
      const valid = queue.validate();
      if (valid !== true) {
        throw new TypeError(`Invalid TimingWheel payload: ${valid}`);
      }
      return queue;
    });
  }

  private createLevel(): WheelLevel<T> {
    return {
      slots: Array.from({ length: this.slots }, () => []),
      minimum: new Array(this.slots).fill(null),
      occupied: new Uint32Array(Math.ceil(this.slots / 32)),
    };
  }

  private resetWheel(levels: number): void {
    this._wheel = Array.from({ length: levels }, () => this.createLevel());
  }

  /** O(1): appends to a slot and updates its occupancy bit and earliest event. */
  private addToSlot(event: TimerEvent<T>, level: number, slot: number): void {
    const wheel = this._wheel[level];
    const bucket = wheel.slots[slot];
    event.level = level;
    event.slot = slot;
    event.index = bucket.length;
    bucket.push(event);
    if (bucket.length === 1) {
      wheel.occupied[slot >>> 5] |= 1 << (slot & 31);
    }
    const minimum = wheel.minimum[slot];
    if (minimum === null || compareEvents(event, minimum) < 0) {
      wheel.minimum[slot] = event;
    }
  }

  /** O(1) swap-removal, plus a rescan of the slot when `event` was its earliest event. */
  private unlink(event: TimerEvent<T>): void {
    const wheel = this._wheel[event.level];
    const bucket = wheel.slots[event.slot];
    const last = bucket.pop() as TimerEvent<T>;
    if (last !== event) {
      bucket[event.index] = last;
      last.index = event.index;
    }
    if (bucket.length === 0) {
      wheel.occupied[event.slot >>> 5] &= ~(1 << (event.slot & 31));
      wheel.minimum[event.slot] = null;
    } else if (wheel.minimum[event.slot] === event) {
      let minimum = bucket[0];
      for (const candidate of bucket) {
        if (compareEvents(candidate, minimum) < 0) {
          minimum = candidate;
        }
      }
      wheel.minimum[event.slot] = minimum;
    }
  }

  /** O(1): empties a slot and returns its former contents. */
  private takeSlot(level: number, slot: number): Array<TimerEvent<T>> {
    const wheel = this._wheel[level];
    const bucket = wheel.slots[slot];
    if (bucket.length > 0) {
      wheel.slots[slot] = [];
      wheel.minimum[slot] = null;
      wheel.occupied[slot >>> 5] &= ~(1 << (slot & 31));
    }
    return bucket;
  }

  private place(event: TimerEvent<T>): void {
    const delay = event.tick - this._currentTick;
    if (delay <= 0) {
      this.addToSlot(event, 0, this.slotOf(this._currentTick, 0));
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
    if (level >= 64) {
      throw new RangeError("event is too far in the future for the wheel geometry");
    }
    while (level >= this._wheel.length) {
      this._wheel.push(this.createLevel());
    }
    this.addToSlot(event, level, this.slotOf(event.tick, level));
  }

  private slotOf(tick: number, level: number): number {
    const period = Math.pow(this.slots, level);
    return Math.floor(tick / period) % this.slots;
  }

  /**
   * O(levels · ⌈slots/32⌉): the earliest pending event. Level 0 holds ticks
   * [current, current + slots) starting at the current slot; a coarser level's current slot only
   * holds events a full rotation ahead, so its scan starts at the next slot and wraps. Within a
   * level, the first occupied slot in that order holds the level's earliest event.
   */
  private findEarliest(): TimerEvent<T> | null {
    if (this._size === 0) {
      return null;
    }
    let best: TimerEvent<T> | null = null;
    for (let level = 0; level < this._wheel.length; level++) {
      const wheel = this._wheel[level];
      const current = this.slotOf(this._currentTick, level);
      const start = level === 0 ? current : (current + 1) % this.slots;
      let slot = firstSetBit(wheel.occupied, start, this.slots);
      if (slot < 0 && start > 0) {
        slot = firstSetBit(wheel.occupied, 0, start);
      }
      if (slot < 0) {
        continue;
      }
      const minimum = wheel.minimum[slot] as TimerEvent<T>;
      if (best === null || compareEvents(minimum, best) < 0) {
        best = minimum;
      }
    }
    return best;
  }

  private advanceTick(tick: number, due: Array<TimerEvent<T>>, limit: number): void {
    this._currentTick = tick;
    for (let level = this._wheel.length - 1; level >= 1; level--) {
      const period = Math.pow(this.slots, level);
      if (tick % period !== 0) {
        continue;
      }
      for (const event of this.takeSlot(level, this.slotOf(tick, level))) {
        this.place(event);
      }
    }
    this.drainSlot(tick, due, limit);
  }

  /** Moves the slot's events with time <= limit to `due`; later ones (same tick) stay. */
  private drainSlot(tick: number, due: Array<TimerEvent<T>>, limit: number): void {
    const slot = this.slotOf(tick, 0);
    for (const event of this.takeSlot(0, slot)) {
      if (event.time > limit) {
        this.addToSlot(event, 0, slot);
        continue;
      }
      due.push(event);
      this._eventsById.delete(event.id);
      this._size--;
    }
  }

  /** O(k log k): orders and returns delivered events, refreshing the cached earliest if needed. */
  private deliver(due: Array<TimerEvent<T>>): T[] {
    due.sort(compareEvents);
    for (const event of due) {
      event.cancelled = true;
    }
    if (this._earliest !== null && this._earliest.cancelled) {
      this._earliest = this.findEarliest();
    }
    this.touch();
    return due.map((event) => event.value);
  }

  /** Tick of an event time: the boundary at or after it when quantized, else the containing tick. */
  private tickOf(time: number): number {
    const scaled = time / this.tickSize;
    const tick = this._quantized ? Math.ceil(scaled) : Math.floor(scaled);
    if (!Number.isFinite(tick) || tick < 0 || tick > Number.MAX_SAFE_INTEGER) {
      throw new RangeError("event time is outside the representable tick range");
    }
    return tick;
  }

  /**
   * Whether an event with this time and tick may legitimately still be pending at the current
   * tick: its tick is still ahead, or it is in the current tick and not before `now` (scheduled at
   * `now`, or, without quantization, later in the tick that contains `now`).
   */
  private isPendingState(time: number, tick: number): boolean {
    return tick > this._currentTick || (tick === this._currentTick && time >= this._now);
  }

  /** Delivery rule shared by stepped advance and fast-forward. */
  private isDue(event: TimerEvent<T>, time: number, targetTick: number): boolean {
    return this._quantized ? event.tick <= targetTick : event.time <= time;
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
      if (this.isDue(event, time, targetTick)) {
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
    this.resetWheel(this._initialLevels);
    for (const event of future) {
      this.place(event);
    }
    this._earliest = this.findEarliest();
    return this.deliver(due);
  }

  private restore(events: readonly SerializedEvent[], nextId: number, nextSeq: number): void {
    for (const item of events) {
      const tick = this.tickOf(item.time);
      if (!this.isPendingState(item.time, tick)) {
        throw new TypeError("serialized event should already have been delivered");
      }
      const event: TimerEvent<T> = {
        id: item.id,
        time: item.time,
        seq: item.seq,
        tick,
        value: item.value as T,
        cancelled: false,
        level: 0,
        slot: 0,
        index: 0,
      };
      this._eventsById.set(event.id, event);
      this._size++;
      this.place(event);
      if (this._earliest === null || compareEvents(event, this._earliest) < 0) {
        this._earliest = event;
      }
    }
    this._nextId = nextId;
    this._seq = nextSeq;
  }
}
