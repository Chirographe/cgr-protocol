# Chirographe Protocol

## 1. Model

A token is a signed object held by its owner. Its state names one owner and one guardian group. A state can be spent once: a transition is final when a quorum of the group has recorded it in their ledgers and signed it.

| Role | Function |
| --- | --- |
| Owner | k of n keys. A single key is a group of 1 |
| Guardian | Keeps an append-only Merkle ledger and votes. Cannot move a token alone |
| Group | n guardians with a threshold. Members never talk to each other: the client collects votes |
| Recovery group | Fixed at creation. Takes over a token after a public notice period |
| Witness | Countersigns ledger heads and proves forks |
| Relay | Mailbox hosted by a guardian. Untrusted, sees only ciphertext |

## 2. Encoding

- Keys: `<algorithm>:` + base64url of the public key. The only algorithm is `p256`: ECDSA P-256, SPKI DER. Unknown prefixes, invalid points and non-canonical base64url are rejected.
- `H(x)`: SHA-256 of the RFC 8785 canonical JSON of `x`, as `sha256:` + 64 lowercase hex characters.
- `bytes(h)`: the 32 bytes of a hash.
- Zero hash: `sha256:` + 64 zeros.
- base64url has no padding. Dates are ISO 8601 UTC with a `Z` suffix.
- Objects with unknown fields are rejected.
- Verifiers accept high-S signatures.

## 3. Data

```text
Token       { format: "chirographe/1", rules, state, signatures }

rules       { creator: Owner, subject: string, description?: string|null, nonce: hex,
              created_at: Date, initial_guardian: Group,
              allowed_guardians: Key[]|null, recovery: Recovery|null }

state       { token_id: Hash, sequence: int, previous: Hash|null, owner: Owner,
              ephemeral?: Key, guardian: Group, date: Date, expires_at?: Date }

Owner       { keys: Key[], threshold: int }
Group       { members: [{ key: Key, url }], threshold: int }
Recovery    { group: Group, delay_seconds: int }

signatures  { senders: OwnerSig[], receivers?: OwnerSig[], guardians?: GuardianSig[],
              incoming_guardians?: EntrySig[], takeover?: true }

OwnerSig    { type: "raw", key, signature }
GuardianSig { type: "raw", key, line, line_hash, signature, rotations?: Rotation[] }
EntrySig    { type: "raw", key, signature, rotations?: Rotation[] }
Rotation    { previous, next, previous_signature, next_signature }

Line        { n, type, token_id, state_hash, spent, origin, date }
Head        { n, root, date, signature, locked? }
```

- `token_id = H(rules)`. `nonce` is 16 random bytes.
- `sequence` is 0 at creation and increases by 1 with each state.
- An owner has 1 to 31 distinct keys, and 1 ≤ `threshold` ≤ n.
- A group has 1 to 31 distinct keys. With f = ⌊(n − 1) / 3⌋, `threshold` satisfies ⌈(n + f + 1) / 2⌉ ≤ `threshold` ≤ n.
- Two owners or groups are equal when their hashes are equal: order matters.

### Ledger

`n` starts at 1 and is continuous. `line_hash = H(line)`.

`root` is the RFC 9162 Merkle Tree Hash of the first `n` lines, in `sha256:` form, with `bytes(line_hash)` as leaves. Inclusion and consistency proofs follow RFC 9162, section 2.1.

A non-null `spent` is unique in a ledger. Two lines with the same `spent` prove guardian fraud.

| `type` | Written when | `state_hash` | `spent` | `origin` |
| --- | --- | --- | --- | --- |
| `creation` | Token created | New state | `null` | `null` |
| `transfer` | State spent, same group | New state | `state.previous` | `null` |
| `departure` | State spent, group changes | New state | `state.previous` | `null` |
| `arrival` | Token enters the group | New state | `state.previous`, or `null` if already in this ledger | `{ guardian, line }` of the first certificate signature |
| `catch_up` | Late member receives a certificate | New state | `null` | `null` |
| `announcement` | Recovery announced | Recovery state | `null` | `null` |
| `opposition` | Recovery opposed | Opposing state | `null` | `null` |
| `takeover` | Recovery completed | Recovery state | `null` | `null` |
| `rotation` | Key rotated | `H(rotation)` | `null` | Rotation |

A `rotation` line has the zero hash as `token_id`.

## 4. Signatures

Signed messages, in UTF-8 unless stated:

```text
owner     bytes(H(state))
session   chirographe/1|session|<challenge>
guardian  chirographe/1|guardian|<H(state)>|<line>|<line_hash>
entry     chirographe/1|entry|<H(state)>
head      chirographe/1|head|<n>|<root>
rotation  chirographe/1|rotation|<previous>|<next>
witness   chirographe/1|witness|<guardian key>|<n>|<root>
```

A rotation is signed by both keys over the same message.

`raw`: signature by the algorithm of the key. For `p256`: ECDSA-SHA256 over the message, in r‖s format (64 bytes), base64url.

### Quorum

Owner: `quorum(O, sigs)` holds when at least `O.threshold` distinct keys of `O` have a valid signature over `bytes(H(state))`.

Group: a signature with `rotations = [R1 … Rm]` carries the key history `[R1.previous … Rm.previous, key]`. Each rotation must be valid, each `Ri.next` must equal the next `previous`, and `Rm.next` must equal `key`.

`quorum(G, sigs, msg)` holds when at least `G.threshold` distinct members of `G` have a valid signature over `msg`. A signature counts for a member if that member's key is in its key history.

## 5. Addresses and relay

```text
Address { scan: Key, keys: Key[], threshold: int, relay: url, stealth: bool }
```

Text form: `cgr:` + base64url of the canonical JSON. The holder keeps the private keys `a` of `scan` and `b_j` of `keys[j]`.

### One-time owner

If `stealth` is true, the sender derives a new owner for each state. With `r` a fresh random scalar, `G` the generator and `q` the group order:

```text
x     = x-coordinate of r·scan, 32 bytes        recipient: a·ephemeral
s_j   = SHA-256("chirographe/1|stealth|" ‖ x ‖ j) mod q   j on one byte, s_j ≠ 0
P_j   = keys[j] + s_j·G
```

The state carries `ephemeral = r·G` and `owner = { keys: [P_j], threshold }`. The private key of `P_j` is `b_j + s_j mod q`.

If `stealth` is false, the state has no `ephemeral`, and `owner` is `{ keys, threshold }`.

Holders never reuse a one-time key: each token they receive, and each key change, derives a new owner.

### Relay messages

Messages are encrypted to the recipient's `scan` key and posted to `/mailbox/{scan}`:

```text
x       = x-coordinate of r·scan, with a fresh r
key     = SHA-256("chirographe/1|mailbox|" ‖ x)
message = { ephemeral: r·G, ciphertext: base64url(iv ‖ AES-256-GCM(key, iv, content) ‖ tag) }
```

`iv` is 12 random bytes. `content` is one of:

```text
Envelope { from: Address, proposal: Token, previous: Token }
Refusal  { refused: H(state), reason, requested_guardian }
Token
```

### Recovering a wallet

From its private keys alone, a wallet reads `GET /owners` on each known guardian. For each entry, it derives `P_j` from `ephemeral`. On a match, it opens a session with that key and fetches the token. It uses one session per key.

## 6. Token validity

Stages: `proposed` (owner signed), `complete` (all parties signed), `final` (quorum signed). `P` is the previous state, if known.

The signing group `S` is:

- `state.guardian` at creation or with `takeover`;
- otherwise `P.guardian`, if `P` is known;
- otherwise unknown if `incoming_guardians` is non-empty, else `state.guardian`.

The group changes when the state is neither a creation nor a `takeover`, and `S` is unknown or differs from `state.guardian`.

1. `H(rules) == state.token_id`.
2. Creation (`previous` is `null`): `owner == creator`, `quorum(creator, senders)`, `receivers` is absent, `sequence` is 0, and `guardian == initial_guardian`.
3. If `P` is known: `H(P) == state.previous`, `sequence == P.sequence + 1`, and `quorum(P.owner, senders)`.
4. Every signature in `senders` and `receivers` is valid over `bytes(H(state))`.
5. At `complete` and `final`: `senders` and `receivers` together hold `quorum(owner, …)`.
6. `takeover`: `rules.recovery` is set, `guardian == recovery.group`, and `owner` is unchanged from `P`.
7. Group change, at `complete` and `final`: `quorum(state.guardian, incoming_guardians, entry)`.
8. At `final`: `quorum(S, guardians, guardian)`. If `S` is unknown, at least one signature in `guardians` is valid.
9. If `allowed_guardians` is set and `takeover` is absent, it lists every member of `state.guardian`.
10. Before `final`: `expires_at`, if present, is in the future.

## 7. Operations

The client drives every operation. A quorum call goes to all members in parallel and succeeds with `threshold` positive answers. Broadcast means `POST /tokens/certify` to all members, without requiring a quorum. Votes are merged by `key` into `signatures.guardians`.

**Create.** Build `rules`, then `state` with `guardian = initial_guardian`. A quorum of the owner signs `senders`. Quorum call to `/tokens/create`, then broadcast.

**Propose.** From the current state `E`, the owner builds a state with `sequence = E.sequence + 1`, `previous = H(E)`, the new owner and group, and `expires_at`. A quorum of the owner signs `senders`.

**Transfer.**

1. The owner posts an Envelope to the recipient's relay.
2. The recipient runs the checks in section 9.
3. To accept, a quorum of the new owner signs `receivers`, commits, and posts the final token to the sender's relay.
4. To refuse, the recipient posts a Refusal. Nothing is recorded.

**Cancel.** The owner commits a transfer to themselves, which spends the current state.

**Commit**, with `A` the previous group and `N` the proposed group:

1. If `A ≠ N`: quorum call to `/tokens/enter` on `N`, and store the answers in `incoming_guardians`.
2. Broadcast the previous token to `A`.
3. Quorum call to `/tokens/validate` on `A`.
4. If `A ≠ N`: quorum call to `/tokens/certify` on `N`.
5. Broadcast the final token to `A` and `N`.

Every step is idempotent, so a failed commit is resumed by running it again.

**Change guardian.** Propose with the new group, then commit. If the owner is unchanged, `receivers` is omitted.

**Change keys.** Transfer to a new owner, which needs `threshold` of the old keys and of the new keys. This replaces lost keys and moves a token to a new algorithm.

**Recover.** Requires `rules.recovery`.

1. The owner proposes `guardian = recovery.group`, same owner, no `expires_at`, `takeover: true`.
2. Quorum call to `/recovery/request`. Each member records `announcement` and sets `ends_at = now + delay_seconds`.
3. Until `ends_at`, a holder of a later state can call `/recovery/oppose`.
4. After `ends_at`, quorum call to `/recovery/finalize`, then broadcast to both groups.

**Rotate key.** The guardian signs a Rotation with both keys, records a `rotation` line, switches key, and publishes the head under the new key. All later signatures carry its rotations. `state.guardian` keeps the old key, resolved through that history. A guardian moves to a new algorithm the same way.

## 8. Guardian rules

- Each operation runs in one serialized transaction: read the head, verify, append the line.
- A line reaches stable storage before its signature is returned.
- The signed head is published atomically after commit.
- The guardian keeps the full token for each `state_hash`, and an index `token_id → n, state_hash, sequence, here, group`. A token is `here` if the guardian belongs to `state.guardian`.
- A guardian belongs to a group under any of its past or present keys, and its `url` in the group must be its own.
- Replaying a recorded state returns the stored token without a new line.
- At startup, the guardian checks the signature of the last published head, and recomputes `root` over its first `n` lines. One more line than `n` is a crash before publication: the guardian finishes that operation and publishes the head. On any other mismatch it stops signing, serves reads, and sets `locked: true`.

| Route | Rule |
| --- | --- |
| `/tokens/create` | Token is `complete`, `previous` is `null`, guardian is a member, `token_id` is unknown. Record `creation` and sign |
| `/tokens/validate` | Token has no `takeover` and is `here`, `previous` is the head, token is `complete` against the stored head. Record `transfer` or `departure` and sign. The answer carries this member's vote only |
| `/tokens/enter` | Guardian belongs to `state.guardian` and the group differs. `previous` is `final`, proposal is `proposed` against it, and no other head is held `here`. Store the commitment and return an EntrySig. No line is written |
| `/tokens/certify` | `previous`, if any, and the token are `final`. Guardian belongs to one of the groups. Ignore a lower `sequence` or the current head. Otherwise record `arrival` if entering with `incoming_guardians`, else `catch_up` |
| `/recovery/request` | Token has `takeover`, `previous` is `final`, guardian is in `recovery.group`. At most one open request per token. Record `announcement` |
| `/recovery/oppose` | A request is open, and the token is not the recovery state. With `R` the claimed state, accept a `final` token whose `previous` is `H(R)`, or a `final` token with `sequence > R.sequence`. Record `opposition` and close the request |
| `/recovery/finalize` | `ends_at` has passed without opposition. Record `takeover` and sign |

A guardian may refuse a creation, an arrival or a proposal duration by policy.

## 9. Recipient and witness rules

Before signing, the recipient checks `P` (previous token) and `Q` (proposal). All are blocking except the last two:

1. `H(Q.rules) == Q.state.token_id` and `H(P.state) == Q.state.previous`.
2. `P` is `final`.
3. `Q.senders` hold `quorum(P.state.owner, …)`.
4. `Q.state.owner` is the recipient's: derived from `ephemeral`, or the recipient's keys if `stealth` is false.
5. `expires_at` has not passed.
6. No more than f members of `Q.state.guardian` are blocked by the recipient.
7. At least `threshold` members of `P.state.guardian` report `H(P.state)` as the head, with `here: true`.
8. No member of `recovery.group` announces this token with a status other than `opposed`.
9. Ledger check passes for each signature in `P`: otherwise warn.
10. All members of `Q.state.guardian` are trusted by the recipient: otherwise warn.

**Ledger check.** The client stores the last head seen per guardian. It treats the ledger as rewritten unless:

- `locked` is absent;
- the head is signed by the guardian's key, following its published rotations;
- a consistency proof links the stored head to the new head.

To check a token, it also fetches the line named by the signature, and verifies `H(line) == line_hash`, `state_hash == H(state)`, and an inclusion proof under the head.

**Witness.** A witness periodically reads every line of each guardian it follows. It recomputes `root`, rejects a repeated `spent`, keeps `root` for each `n`, countersigns the head, and records the guardian's last answer.

Clients submit the heads they see. A fork proof is two heads signed by the same guardian with the same `n` and different `root`.

## 10. API

JSON over HTTPS. Sessions use `Authorization: Bearer <session>`.

| Route | Body | Response |
| --- | --- | --- |
| `GET /.well-known/guardian` | | `{ key, name, url, version, policy, rotations }` |
| `GET /ledger/head` | | Head |
| `GET /ledger/lines?from&limit` | | `{ lines }` |
| `GET /ledger/proof?line&size` | | `{ path }`, inclusion proof |
| `GET /ledger/consistency?from&to` | | `{ path }`, consistency proof |
| `GET /tokens/{id}/head` | | `{ here: true, state_hash, n, sequence }` or `{ here: false, moved_to, sequence }` |
| `POST /tokens/create` | Token | 201, token with vote |
| `POST /tokens/validate` | Token | Token with vote |
| `POST /tokens/enter` | `{ proposal, previous }` | `{ incoming_guardian }` |
| `POST /tokens/certify` | `{ token, previous }` | `{ line }` |
| `GET /recovery/announcements` | | `{ announcements: [{ token_id, state_hash, claimed_sequence, ends_at, status }] }` |
| `POST /recovery/request` | `{ proposal, previous }` | `{ ends_at, line }` |
| `POST /recovery/oppose` | `{ token, previous }` | `{ line }` |
| `POST /recovery/finalize` | `{ state_hash }` | Token with vote |
| `POST /mailbox/{scan}` | Relay message | 201, `{ id }` |
| `GET /mailbox/{scan}` (session) | | `{ messages: [{ id, date, content }] }` |
| `DELETE /mailbox/{scan}/{id}` (session) | | `{ ok: true }` |
| `POST /auth/challenge` | `{ key }` | `{ challenge }` |
| `POST /auth/response` | `{ key, challenge, signature }` | `{ session }` |
| `GET /owners?from&limit` | | `{ owners: [{ n, ephemeral, owner }] }`, heads held here |
| `GET /owners/{key}/tokens` (session) | | `{ tokens }` whose owner includes `key` |
| `GET /.well-known/witness` | | `{ key, name }` |
| `GET /guardians` (witness) | | `{ guardians: [{ key, url, last_response, head, frauds }] }` |
| `POST /heads` (witness) | `{ guardian, head }` | `{ ok, fraud }` |

Errors have the form `{ "error": "CODE", "message": "text" }`.

| Code | HTTP | Case |
| --- | --- | --- |
| `INVALID_FORMAT` | 400 | Invalid structure |
| `RULES_TAMPERED` | 400 | `H(rules) ≠ token_id` |
| `INVALID_SIGNATURE` | 400 | Invalid or missing signature or quorum |
| `PROPOSAL_EXPIRED` | 400 | `expires_at` has passed |
| `UNAUTHENTICATED` | 401 | Missing or expired session |
| `GUARDIAN_NOT_ALLOWED` | 403 | Member not in `allowed_guardians` |
| `POLICY_REFUSED` | 403 | Guardian policy, or recovery delay still running |
| `UNKNOWN_STATE` | 404 | Unknown token, state or request |
| `STATE_ALREADY_SPENT` | 409 | `previous` is no longer the head |
| `TOKEN_MOVED` | 409 | Token left, with `moved_to` |
| `TOO_MANY_REQUESTS` | 429 | Rate limit reached |
| `LEDGER_LOCKED` | 503 | Guardian has stopped signing |
