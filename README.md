<p align="center"><img src="assets/cgr-protocol-icon-1024.png" width="160" alt="CGR Protocol"></p>

# CGR Protocol

Unforgeable, non-duplicable digital tokens, without a blockchain. Each token is held by its owner, and a group of guardians guarantees that each of its states is spent only once.

- [PROTOCOL.md](PROTOCOL.md): the protocol specification.
- [packages/core](packages/core): the reference implementation, `@chirographe/core`. Runs anywhere `fetch` does.
- [packages/server](packages/server): HTTP servers for guardians and witnesses, on any storage.
- [packages/storage-sqlite](packages/storage-sqlite): a storage driver, on SQLite.
- [apps/server](apps/server): a guardian or a witness on SQLite, ready to run.

## Development

Node 24+ and pnpm.

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm lint
```

## Running a guardian

```sh
cp .env.example .env   # then fill it in
set -a; . ./.env; set +a
pnpm guardian
```

It serves plain HTTP on `127.0.0.1`: put a reverse proxy in front of it for HTTPS. `DATA_PATH` holds the ledger and the guardian key, sealed with `GUARDIAN_PASSWORD`. Lose either one and the guardian is gone, so back up that folder and keep the password apart from it.

To rotate the key, stop the guardian and run `pnpm guardian:rotate`. `pnpm witness` runs a witness the same way.

## Using another storage

`core` and `server` know nothing about storage technology. A driver implements `GuardianStorage` or `WitnessStorage`, and [apps/server](apps/server) names the driver on one line.

A driver proves itself with the shared suite. It only needs a test runner:

```ts
import { guardianStoreCases } from '@chirographe/core/conformance'

for (const { name, run } of guardianStoreCases(() => openMyStore())) it(name, run)
```

The suite also has `mailboxStoreCases`, `witnessStoreCases` and `keyVaultCases`. To keep keys in an HSM or a KMS, implement `Keyring` instead of `KeyVault`.

## Using a guardian from a client

`httpDirectory()` gives the operations of `core` their network. Pass your own `fetch` for a runtime that has none.

```ts
const directory = httpDirectory()
await commit(directory, proposal, previous)
```
