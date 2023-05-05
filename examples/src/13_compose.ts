import {
  AudioMixerSettings,
  audioToPin,
  ComposePart,
  ComposeVideoSettings,
  LocalFileInputSettings,
  Norsk,
  selectAudio,
  selectVideo,
  SrtInputSettings,
  videoToPin,
} from "@id3asnorsk/norsk-sdk";
import fs from "fs/promises";

export async function main() {
  const fileName = await fs.realpath("./data/Norsk.png");

  const srtSettings: SrtInputSettings = {
    id: "srtInput",
    ip: "127.0.0.1",
    port: 5001,
    mode: "listener",
    sourceName: "srtInput1",
  };

  const rtmpSettings = { id: "rtmpInput", port: 5002 };

  const fileSettings: LocalFileInputSettings = {
    fileName,
    sourceName: "logoInput",
    id: "logoInput"
  };

  const topRight = { x: 50, y: 5, width: 45, height: 45 };
  const bottomRight = { x: 50, y: 50, width: 45, height: 45 };
  const bottomLeft = { x: 5, y: 50, width: 45, height: 45 };

  const background: ComposePart<"background"> = {
    pin: "background",
    opacity: 1.0,
    zIndex: 0,
    sourceRect: { x: 0, y: 0, width: 100, height: 100 },
    destRect: { x: 0, y: 0, width: 100, height: 100 },
  };
  const embedded: ComposePart<"embedded"> = {
    pin: "embedded",
    opacity: 1.0,
    zIndex: 1,
    sourceRect: { x: 0, y: 0, width: 100, height: 100 },
    destRect: topRight,
  };
  const logo: ComposePart<"logo"> = {
    pin: "logo",
    opacity: 1.0,
    zIndex: 2,
    sourceRect: { x: 0, y: 0, width: 100, height: 100 },
    destRect: { x: 5, y: 5, width: 10, height: 8 },
  };

  const parts = [background, embedded, logo];

  const composeSettings: ComposeVideoSettings<
    "background" | "embedded" | "logo"
  > = {
    id: "compose",
    referenceStream: background.pin,
    referenceResolution: { width: 100, height: 100 }, // make it % based
    outputResolution: { width: 1280, height: 720 },
    parts,
    outputPixelFormat: "rgba",
    onError: () => process.exit(), // interval keeps this script alive after nodes close
  };

  const norsk = await Norsk.connect({});
  let input1 = await norsk.input.srt(srtSettings);
  let input2 = await norsk.input.rtmpServer(rtmpSettings);
  let input3 = await norsk.input.imageFile(fileSettings);

  let compose = await norsk.processor.transform.composeOverlay(composeSettings);

  let output = await norsk.duplex.localWebRTC({ id: "webrtc" });

  compose.subscribeToPins([
    { source: input1, sourceSelector: videoToPin(background.pin) },
    { source: input2, sourceSelector: videoToPin(embedded.pin) },
    { source: input3, sourceSelector: videoToPin(logo.pin) },
  ]);

  let mixerSettings: AudioMixerSettings<"input1" | "input2"> = {
    id: "mixer",
    onError: (err) => console.log("MIXER ERR", err),
    sampleRate: 48000,
    sources: [
      { pin: "input1" },
      { pin: "input2" }
    ],
    outputSource: "output",
  };

  let mixer = await norsk.processor.transform.audioMixer(mixerSettings);
  mixer.subscribeToPins([
    { source: input1, sourceSelector: audioToPin('input1') },
    { source: input2, sourceSelector: audioToPin('input2') }
  ]);

  output.subscribe([
    { source: compose, sourceSelector: selectVideo },
    { source: mixer, sourceSelector: selectAudio },
  ]);

  console.log(`Local player: ${output.playerUrl}`);

  let newParts = [background, { ...embedded, destRect: topRight }, logo];
  let changeCount = 0;
  setInterval(() => {
    switch (changeCount % 4) {
      case 0:
        newParts = [background, { ...embedded, destRect: topRight }, logo];
        break;
      case 1:
        newParts = [background, { ...embedded, destRect: bottomRight }, logo];
        break;
      case 2:
        newParts = [background, { ...embedded, destRect: bottomLeft }, logo];
        break;
      case 3:
        newParts = [background, logo];
        break;
    }
    compose.updateConfig({ parts: newParts });
    changeCount += 1;
  }, 2000);
}