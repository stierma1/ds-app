# Application Write-ups

One document per application module (Phase 8 of the roadmap). Each write-up
explains the use case, states the problem precisely, walks through how the
problem is solved, lists the parts it composes, and names the data used to
validate and benchmark it. API contracts for these modules are added when
Phase 8 begins; the examples here are sketches.

| # | Document | Module | Composes |
|---|----------|--------|----------|
| A1 | [IP Router Tables](./A01-ip-router.md) | `applications/ip-router` | 22, 26, 8 |
| A2 | [Packet Classification](./A02-packet-classification.md) | `applications/packet-classification` | 22, 8, 24, 17 |
| A3 | [The Web as a Dynamic Graph](./A03-web-graph.md) | `applications/web-graph` | 3, 26, 29, 24 |
| A4 | [VLSI Layout](./A04-layout.md) | `applications/layout` | 16, 17, 20 |
| A5 | [Floorplan Representation](./A05-floorplan.md) | `applications/floorplan` | 2, 3, 27, 9 |
| A6 | [Computer Graphics](./A06-graphics.md) | `applications/graphics` | 19, 20, 15, 16, 2 |
| A7 | [Geographic Information Systems](./A07-gis.md) | `applications/gis` | 20, 18, 16, 14, A9 |
| A8 | [Collision Detection](./A08-collision.md) | `applications/collision` | 20, 15, 18, 31, 1 |
| A9 | [Computational Geometry](./A09-computational-geometry.md) | `applications/computational-geometry` | 16, 15, 9, 6 |
| A10 | [Text Retrieval](./A10-text-retrieval.md) | `applications/text-retrieval` | 26, 22, 6, 15, 8, 35 |
| A11 | [Image Data Structures](./A11-image.md) | `applications/image` | 18, 24, 1, 20 |
| A12 | [Data Mining](./A12-data-mining.md) | `applications/data-mining` | 22, 8, 15, 20, 6, 24 |
| A13 | [Compression](./A13-compression.md) | `applications/compression` | 23, 1, 13, 22, 8 |
| A14 | [Route Planning](./A14-route-planning.md) | `applications/route-planning` | 3, 6, 36, 20 |
| A15 | [Caching and Simulation](./A15-caching-simulation.md) | `applications/caching-simulation` | 8, 1, 6, 12 |

Applications A1 through A9 follow the Handbook's application chapters; A10
through A12 cover its remaining application chapters (web information
retrieval, image data structures, data mining); A13 through A15 are common
uses of the parts that the book does not treat as chapters.

Every application module may define domain-specific structures, but each
must implement the common contract (`Container` where applicable,
`validate()`, and the shared error types) and build on the public APIs of the
parts it composes.
