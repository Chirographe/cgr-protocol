import {
  closeOnSignal,
  readGuardianConfig,
  rotateGuardianKey,
  startGuardian,
} from '@chirographe/server'
import { semaphoreScheme } from '@chirographe/semaphore'
import { openGuardianStorage } from '@chirographe/storage-sqlite'

// The only line that knows the storage technology.
const storage = openGuardianStorage(process.env.DATA_PATH ?? './data')

const config = readGuardianConfig(process.env)
if (process.argv[2] === 'rotate') {
  await rotateGuardianKey(config, storage)
} else {
  // Ballots of `vote/1` carry Semaphore proofs.
  const { app } = await startGuardian(config, storage, { schemes: [semaphoreScheme] })
  closeOnSignal(app)
}
