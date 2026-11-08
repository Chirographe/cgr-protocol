# Profiles

A profile gives meaning to tokens. Guardians never read it: it is a convention between clients, named by `rules.profile`. Each one fixes the predicates, the covenant and the `data` of its tokens, and what a party checks before signing (check 2 of section 9).

A document is never on a token. `data` holds a label and `digestOf(file, salt)` = `H({ salt, sha256: hex(SHA-256(file)) })`, and the salt travels with the file, outside the protocol.

## `title/1`

A property title.

| | |
| --- | --- |
| `issuer` | The registry's keys, or the holder's for a self-issued title |
| `lock` | The holder's address |
| `covenant` | `keep: [data]`, `accept` |
| `data` | `{ label, digest }` |

A transfer spends the title into the same output with the recipient's lock. `accept` makes the recipient sign it: nobody receives a title without consent. The recipient checks that the title is unchanged and locked to them alone.

## `contract/1`

A contract between parties.

| | |
| --- | --- |
| `issuer`, `lock` | `{ threshold: n, of: [each party's address lock] }` |
| `covenant` | `keep: [lock]` |
| `data` | `{ label, digest }` |

Every party signs its creation, each amendment (a new `data`) and its termination (a spend without continuation). The parties never change. A party checks that it is one of them, and that the digest is that of the document it was shown. The date of a version is that of the guardians' lines.

## `vote/1`

An anonymous vote, one ballot per registered voter.

| | |
| --- | --- |
| `issuer` | The organizer's key |
| `lock` | `and(sig(organizer), after(close))` |
| `claim` | `and(member(root, "semaphore/4"), before(close))` |
| `data` | `{ question, options, roll }` |

Voters register `commitmentOf(identity)` with the organizer, who publishes the roll `{ commitments }` at the `roll` URL and puts its root in the claim. A ballot is a transition with one claim under the election, no output, and `data` `{ choice }`. Its proof shows that the voter is on the roll without saying who, and its nullifier stops a second ballot. The lock keeps the roll fixed until the vote closes. Anyone counts with `tally`, from the claims the election's group returns.

Ballots are public: secrecy before the close and resistance to coercion are not provided.
