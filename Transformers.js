import { env, Whisper } from '@xenova/transformers';

// Point to your local folder
env.localModelPath = './models/whisper-small/';
env.allowRemoteModels = false;

// Then load
const model = await Whisper.from_pretrained(
  './models/whisper-small/',
  { quantized: true, local: true }
);

