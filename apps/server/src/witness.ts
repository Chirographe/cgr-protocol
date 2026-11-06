import { closeOnSignal, readWitnessConfig, startWitness } from '@chirographe/server'
import { openWitnessStorage } from '@chirographe/storage-sqlite'

// The only line that knows the storage technology.
const storage = openWitnessStorage(process.env.DATA_PATH ?? './data')

const { app } = await startWitness(readWitnessConfig(process.env), storage)
closeOnSignal(app)
