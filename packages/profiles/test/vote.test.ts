import { describe, expect, it } from 'vitest'
import { ProtocolError, commit, generateSigner, outputId, signTransition } from '@chirographe/core'
import { commitmentOf, createIdentity, registerSemaphore } from '@chirographe/semaphore'
import {
  VOTE,
  castBallot,
  closesAt,
  createElection,
  electionData,
  matchesRoll,
  tally,
} from '../src/index.ts'
import { Network } from './support.ts'

registerSemaphore()
const PROVING_TIMEOUT = 180_000

describe(VOTE, () => {
  it(
    'counts one anonymous ballot per registered voter until it closes',
    async () => {
      const net = new Network()
      const group = await net.group(['a', 'b', 'c', 'd'], 3)
      const organizer = generateSigner()
      const voters = [createIdentity(), createIdentity(), createIdentity(), createIdentity()]
      const roll = { commitments: voters.map(commitmentOf) }
      const closes = new Date(net.now.getTime() + 3600_000)
      const data = {
        question: 'Paint the hall?',
        options: ['Yes', 'No'],
        roll: 'https://rolls.test/1',
      }

      const created = await commit(
        net.directory,
        await signTransition(
          createElection({ organizer: organizer.key, group, data, roll, closesAt: closes }),
          [organizer],
        ),
        [],
      )
      const election = created.body.outputs[0]!
      expect(electionData(election)).toEqual(data)
      expect(closesAt(election)).toEqual(closes)
      expect(matchesRoll(election, roll)).toBe(true)
      expect(matchesRoll(election, { commitments: roll.commitments.slice(1) })).toBe(false)

      const vote = async (voter: number, choice: number) =>
        commit(
          net.directory,
          await castBallot({ election, identity: voters[voter]!, roll, choice }),
          [created],
        )

      const ballots = [await vote(0, 0), await vote(1, 1), await vote(2, 0)]
      await expect(vote(0, 1)).rejects.toSatisfy(
        (e) => e instanceof ProtocolError && e.code === 'ALREADY_SPENT',
      )
      const outsider = await castBallot({
        election,
        identity: createIdentity(),
        roll,
        choice: 1,
      }).catch(() => null)
      expect(outsider).toBeNull()

      expect(tally(election, [...ballots, ballots[0]!])).toEqual({ counts: [2, 1], ballots: 3 })
      const recorded = await net.directory(group.members[3]!.url).claims(outputId(election))
      expect(tally(election, recorded)).toEqual({ counts: [2, 1], ballots: 3 })

      const late = createIdentity()
      const lateRoll = { commitments: [...roll.commitments, commitmentOf(late)] }
      await expect(
        castBallot({ election, identity: late, roll: lateRoll, choice: 1 }),
      ).rejects.toThrow('roll')

      const tooLate = await castBallot({ election, identity: voters[3]!, roll, choice: 1 })
      net.advance(3600)
      await expect(commit(net.directory, tooLate, [created])).rejects.toSatisfy(
        (e) => e instanceof ProtocolError && e.code === 'NOT_AUTHORIZED',
      )
    },
    PROVING_TIMEOUT,
  )
})
