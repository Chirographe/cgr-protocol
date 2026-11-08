import { describe, expect, it } from 'vitest'
import {
  commit,
  mergeEvidence,
  predicateKeys,
  signTransition,
  signersFor,
  utf8,
  type Transition,
  type Wallet,
} from '@chirographe/core'
import {
  CONTRACT,
  amendContract,
  contractData,
  digestOf,
  expectsContract,
  isParty,
  newSalt,
  proposeContract,
  terminateContract,
} from '../src/index.ts'
import { Network, addressOf, newWallet } from './support.ts'

const signAs = (
  wallet: Wallet,
  t: Transition,
  lockOf = t.body.outputs[0] ?? null,
  ephemeral = lockOf?.ephemeral,
) => signTransition(t, signersFor(wallet, lockOf ? predicateKeys(lockOf.lock) : [], ephemeral))

describe(CONTRACT, () => {
  it('needs every party to create, amend and end it', async () => {
    const net = new Network()
    const group = await net.group(['a'], 1)
    const parties = [newWallet(), newWallet(), newWallet()]
    const salt = newSalt()
    const data = { label: 'Lease', digest: digestOf(utf8('v1'), salt) }
    const proposal = proposeContract({ parties: parties.map(addressOf), group, data })
    const contract = proposal.body.outputs[0]!
    expect(parties.every((p) => isParty(contract, p))).toBe(true)
    expect(isParty(contract, newWallet())).toBe(false)
    expect(expectsContract({ transition: proposal, previous: [] }, parties[1]!, data.digest)).toBe(
      true,
    )
    expect(
      expectsContract(
        { transition: proposal, previous: [] },
        parties[1]!,
        digestOf(utf8('v2'), salt),
      ),
    ).toBe(false)

    const signed = await Promise.all(parties.map((p) => signAs(p, proposal)))
    const partial = mergeEvidence(signed[0]!, signed[1]!)
    await expect(commit(net.directory, partial, [])).rejects.toThrow()
    const created = await commit(net.directory, mergeEvidence(partial, signed[2]!), [])

    const current = created.body.outputs[0]!
    const v2 = { label: 'Lease', digest: digestOf(utf8('v2'), salt) }
    const amendment = amendContract(current, v2)
    let amended = amendment
    for (const p of parties) amended = await signAs(p, amended, current)
    const after = await commit(net.directory, amended, [created])
    expect(contractData(after.body.outputs[0]!)).toEqual(v2)

    const last = after.body.outputs[0]!
    let ending = terminateContract(last)
    for (const p of parties) ending = await signAs(p, ending, last)
    await commit(net.directory, ending, [after])
  })
})
