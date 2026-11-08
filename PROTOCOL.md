# Chirographe Protocol

## 1. Model

A token is a chain of outputs. A transition spends outputs and produces new ones. It is final once a quorum of the group holding its inputs has recorded it and signed it. Predicates in the outputs decide who may spend them and what may follow. Guardians evaluate them and never interpret data.

| Role | Function |
| --- | --- |
| Guardian | Keeps an append-only Merkle ledger, evaluates predicates and votes |
| Group | n guardians and a threshold. Members never talk to each other: the client collects votes |
| Recovery group | Fixed when a token is created. Takes custody of it after a public notice |
| Witness | Countersigns ledger heads and proves forks |
| Relay | Mailbox hosted by a guardian. Sees only ciphertext |

## 2. Encoding

- Keys are `<algorithm>:` + base64url. The only algorithm is `p256`: ECDSA P-256, SPKI DER. Unknown prefixes, invalid points and non-canonical base64url are rejected. High-S signatures are accepted.
- `H(x)` is `sha256:` + the lowercase hex SHA-256 of the RFC 8785 canonical JSON of `x`. `bytes(h)` is its 32 bytes.
- A `Value` is any JSON of at most 1024 canonical bytes. base64url has no padding. Dates are ISO 8601 UTC with `Z`. Unknown fields are rejected.

## 3. Data

```text
Transition { format: "chirographe/1", body, evidence, guardians?: Vote[], incoming?: Vote[] }
Body       { group: Group, inputs: Input[], outputs: Output[], data?: Value, valid_until?: Date }
Input      { output: Hash, nullifier?: string }
Output     { rules: Rules, sequence, lock: Predicate, claim?: Predicate, data?: Value,
             ephemeral?: Key, group: Group }
Rules      { profile: string, issuer: Predicate, covenant: Constraint[],
             recovery: { group: Group, delay_seconds }|null, group: Group, nonce: hex }
Group      { members: [{ key, url }], threshold }
Evidence   { signatures: [{ type: "raw", key, signature }], preimages: Value[],
             proofs: [{ scheme, nullifier, proof }] }
Vote       { type: "raw", key, signature, line?, line_hash?, rotations?: Rotation[] }
Rotation   { previous, next, previous_signature, next_signature }
Line       { n, type, hash, spent: Hash[], date }
Head       { n, root, date, signature, locked? }
```

- URLs are `https` (or `http` for local use), compared as written.
- An output is named `H(output)`, its token `H(rules)`. `nonce` is 16 random bytes. `profile`, at most 100 characters, only means something to clients.
- An input without `nullifier` spends its output. With one, it claims under the output, which stays. Either way `H(input)` is consumed once.
- An output starts a token, with `sequence` 0, or continues the token of one spent input, with the same `rules` and `sequence` + 1. A token is started or continued at most once per transition. A spent token that is not continued ends.
- A transition has at most 32 inputs and 32 outputs, and at least one of either.
- A group has 1 to 31 distinct keys. With f = ⌊(n − 1) / 3⌋, ⌈(n + f + 1) / 2⌉ ≤ `threshold` ≤ n. Groups compare by hash.

### Predicates

```text
{ sig: Key }                       a valid signature by Key over bytes(H(body))
{ threshold: k, of: Predicate[] }  at least k of them hold, 1 ≤ k ≤ |of|
{ after: Date }  { before: Date }  the date is at or after, or before, Date
{ hash: Hash }                     a preimage x with H(x) == Hash
{ member: root, scheme }           a proof that the input's nullifier belongs to root
```

At most 4 levels, 32 leaves, and distinct keys. Signatures, preimages and proofs come from the evidence. `member` holds only for a claim. The date is that of the line of the guardian whose vote counts. Before that, a client uses its own clock.

The only scheme is `semaphore/4`. `root` and `nullifier` are decimal BN254 field elements, and `proof` is `{ depth, points }` of a Semaphore v4 proof. It is verified with `scope = H(output)` and `message = H(body)`, read as big-endian integers.

### Constraints

The covenant holds on each output that continues the token, against the output it spends:

```text
{ keep: ("lock" | "claim" | "data")[] }   these fields are unchanged
{ groups: Key[] }                         every member of its group is listed
{ accept: true }                          its lock holds with the evidence
```

### Ledger

Lines are numbered from 1 without gaps. `root` is the RFC 9162 Merkle Tree Hash of the first `n` lines, with `bytes(H(line))` as leaves. Inclusion and consistency proofs follow RFC 9162, section 2.1.

A `transition` line has `hash = H(body)` and spends the inputs not yet spent in this ledger. `notice` and `opposition` lines have `hash = H(body)` of a takeover. A `rotation` line has `hash = H(rotation)`. Only `transition` lines spend. A value spent twice in a ledger proves fraud.

## 4. Signatures

```text
evidence  bytes(H(body))
session   chirographe/1|session|<challenge>
guardian  chirographe/1|guardian|<H(body)>|<line>|<H(line)>
entry     chirographe/1|entry|<H(body)>
head      chirographe/1|head|<n>|<root>
rotation  chirographe/1|rotation|<previous>|<next>
witness   chirographe/1|witness|<guardian key>|<n>|<root>
```

Messages other than `evidence` are UTF-8. `raw` for `p256` is ECDSA-SHA256 in r‖s format, base64url. A rotation is signed by both keys.

A vote with `rotations = [R1 … Rm]` has the key history `[R1.previous … Rm.previous, key]`. Each rotation is valid and leads to the next, and the last leads to `key`. `quorum(G, votes, msg)` holds when at least `G.threshold` distinct members of `G` have a vote over `msg` whose history holds their key.

## 5. Addresses and relay

```text
Address { scan: Key, keys: Key[], threshold, relay: url, stealth: bool }
```

Text form: `cgr:` + base64url of the canonical JSON. Paying an address produces the lock `{ threshold, of: [{ sig: P_j }] }`. `P_j = keys[j]` unless `stealth` is true. In that case, with a fresh scalar `r`, generator `G` and order `q`:

```text
x    = x-coordinate of r·scan (recipient: a·ephemeral)
s_j  = SHA-256("chirographe/1|stealth|" ‖ x ‖ j) mod q, j on one byte, s_j ≠ 0
P_j  = keys[j] + s_j·G, private key b_j + s_j
```

The output carries `ephemeral = r·G`, shared by every address it pays. Holders derive new keys for each output they receive.

A relay message to `/mailbox/{scan}` is `{ ephemeral: r·G, ciphertext }`, where `ciphertext` is base64url of `iv ‖ AES-256-GCM(key, iv, content) ‖ tag`, `key = SHA-256("chirographe/1|mailbox|" ‖ x)` with a fresh `r`, and `iv` is 12 random bytes. `content` is one of:

```text
Request  { from: Address, transition, previous: Transition[] }   asks for evidence
Refusal  { refused: H(body), reason }
Transition
```

To recover a wallet from its keys alone, read `GET /owners` on each known guardian, derive `P_j` from each `ephemeral`, and on a match open a session with that key to fetch the outputs.

## 6. Validity

An input's output is known from the final transition that produced it. A previous transition is final when it has a quorum of its group: its votes vouch for the rest. A spend is a takeover when its output is held by another group, of which `body.group` is the recovery group.

A transition is authorized when:

1. Each input's output is held by `body.group`, or the input is a takeover.
2. Each spend satisfies the `lock` of its output, and each claim its `claim`.
3. Each output that starts a token has `rules.group == body.group` and satisfies `rules.issuer`.
4. Each output that continues a token satisfies its covenant.
5. Each output group `N` other than `body.group` has `quorum(N, incoming, entry)`.
6. `valid_until`, if present, is after the date.

It is final when, in addition, `quorum(body.group, guardians, guardian)` holds.

## 7. Operations

The client drives everything. A quorum call goes to all members in parallel and succeeds with `threshold` answers. A broadcast is `POST /transitions/certify` to all members, with no quorum. Every step is idempotent: a failed operation resumes by running it again.

**Gather.** Each party whose evidence is needed receives a Request. It runs the checks of section 9, then adds its evidence or posts a Refusal.

**Commit**, with `G = body.group` and `N` the other output groups:

1. Quorum call to `/transitions/enter` on each group in `N`, and store the answers in `incoming`.
2. Quorum call to `/transitions/validate` on `G`.
3. Quorum call to `/transitions/certify` on each group in `N`.
4. Broadcast the final transition to `G` and `N`, and post it to the parties.

**Recover.** Quorum call to `/recovery/notice` on `body.group`, which sets `ends_at = now +` the longest `delay_seconds` of the spent tokens. Until then, a holder of a later state calls `/recovery/oppose`. After that, commit.

## 8. Guardians

- Each operation is one serialized transaction: read the head, verify, append the line. A line is durable before its signature is returned. The signed head is published atomically after commit.
- The guardian keeps the transitions it records, with the votes it learns, and an index `token → n, H(output), sequence, here`, where `here` means it belongs to the group of the last output. A head only moves to a higher `sequence`. A token spent without continuation has ended. A replayed transition returns the recorded one.
- Before an operation, a member records the previous transitions it lacks and that concern its groups.
- A guardian belongs to a group under any of its keys, with its own `url`.
- To rotate its key, it signs a Rotation with both keys, records a `rotation` line, and publishes the head under the new key. Groups keep naming the old key.
- At startup, it checks the signature of the last head and recomputes `root`. One extra line means a crash before publication: it publishes that line's head. Any other mismatch locks it: it stops signing, serves reads, and sets `locked: true`.
- It may refuse a new token, an arrival or a validity period by policy.

| Route | Rule |
| --- | --- |
| `/transitions/validate` | Member of `body.group`. Authorized but for votes, previous transitions final, no input spent here, no started token known here. Each output it spends or claims under is the head and `here`, unless it is a takeover whose notice has ended unopposed. Record `transition` and return this member's vote |
| `/transitions/enter` | Member of an output group other than `body.group`. Authorized but for votes and entries, previous transitions final, no entering token `here` unless its head is an output this transition spends. Store the commitment and return a vote, with no line |
| `/transitions/certify` | Member of `body.group` or of an output group. The transition is final. Record `transition` unless already recorded |
| `/recovery/notice` | Member of `body.group` of a takeover, previous transitions final, no open notice on its tokens. Record `notice` |
| `/recovery/oppose` | Open notice on the token. A transition with a quorum of its group spends the noticed output or gives the token a higher `sequence`. Record `opposition` and close the notice |

## 9. Checks

**Party.** Before adding evidence, a party checks each input's output `O` and the transition `P` that produced it. The first six are blocking:

1. `P` is final and produced `O`.
2. The transition is what its profile expects.
3. `valid_until` has not passed.
4. At most f members of `body.group` and of each output group are blocked by the party.
5. At least `threshold` members of `O.group` report `H(O)` as head with `here: true`.
6. No member of the token's recovery group reports a notice that is open, or completed on `O` or later.
7. Each vote in `P` passes the ledger check.
8. The party trusts every member of `body.group` and of each output group.

**Ledger check.** The client keeps the last head seen per guardian. The new head must have no `locked` field, must be signed by the guardian's key through its rotations, and must extend the kept head by a consistency proof. For a vote, the client also fetches its line, and checks `H(line) == line_hash`, that it is a `transition` line with `hash == H(body)`, and an inclusion proof.

**Witness.** A witness reads every line of the guardians it follows, recomputes `root`, rejects a value spent twice, keeps `root` for each `n`, countersigns heads, and records each guardian's last answer. Clients submit the heads they see. Two heads signed by one guardian with the same `n` and different `root` prove a fork.

## 10. API

JSON over HTTPS. Sessions use `Authorization: Bearer <session>`. The `POST` routes of `/transitions` and `/recovery` take `{ transition, previous }`, where `previous` lists the final transitions that produced the inputs.

| Route | Response |
| --- | --- |
| `GET /.well-known/guardian` | `{ key, name, url, version, policy, rotations }` |
| `GET /ledger/head` | Head |
| `GET /ledger/lines?from&limit` | `{ lines }` |
| `GET /ledger/proof?line&size` | `{ path }`, inclusion proof |
| `GET /ledger/consistency?from&to` | `{ path }`, consistency proof |
| `GET /tokens/{token}/head` | `{ here: true, output, n, sequence }` or `{ here: false, moved_to, sequence }`, `moved_to` null once ended |
| `GET /transitions/{hash}` | The transition recorded with this `H(body)` |
| `GET /outputs/{output}/claims` | `{ transitions }` that claimed under this output |
| `POST /transitions/validate` | Transition with vote |
| `POST /transitions/enter` | `{ incoming_guardian }` |
| `POST /transitions/certify` | `{ line }` |
| `GET /recovery/notices` | `{ notices: [{ token, transition, sequence, ends_at, status }] }`, status `open`, `opposed` or `completed` |
| `POST /recovery/notice` | `{ ends_at, line }` |
| `POST /recovery/oppose` | `{ line }` |
| `POST /mailbox/{scan}` with a relay message | 201, `{ id }` |
| `GET /mailbox/{scan}` (session) | `{ messages: [{ id, date, content }] }` |
| `DELETE /mailbox/{scan}/{id}` (session) | `{ ok: true }` |
| `POST /auth/challenge` with `{ key }` | `{ challenge }` |
| `POST /auth/response` with `{ key, challenge, signature }` | `{ session }` |
| `GET /owners?from&limit` | `{ owners: [{ n, ephemeral, keys }] }`, lock keys of heads held here |
| `GET /owners/{key}/outputs` (session) | `{ transitions }` that produced heads whose lock names `key` |
| `GET /.well-known/witness` | `{ key, name }` |
| `GET /guardians` (witness) | `{ guardians: [{ key, url, last_response, head, frauds }] }` |
| `POST /heads` (witness) with `{ guardian, head }` | `{ ok, fraud }` |

Errors are `{ "error": "CODE", "message": "text" }`:

| Code | HTTP | Case |
| --- | --- | --- |
| `INVALID_FORMAT` | 400 | Invalid structure or limit exceeded |
| `NOT_AUTHORIZED` | 400 | A predicate, constraint, signature or quorum fails |
| `EXPIRED` | 400 | `valid_until` has passed |
| `UNAUTHENTICATED` | 401 | Missing or expired session |
| `POLICY_REFUSED` | 403 | Guardian policy, or notice still running |
| `UNKNOWN` | 404 | Unknown token, output, transition or notice |
| `ALREADY_SPENT` | 409 | An input is spent, or its output is no longer the head |
| `TOKEN_MOVED` | 409 | Token left, with `moved_to` |
| `TOO_MANY_REQUESTS` | 429 | Rate limit reached |
| `LEDGER_LOCKED` | 503 | Guardian has stopped signing |
