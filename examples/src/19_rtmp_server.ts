import {
  CmafDestinationSettings,
  CmafMasterOutputNode,
  CmafMasterOutputSettings,
  Norsk,
  RtmpServerInputNode,
  StreamMetadata,
  audioStreamKeys,
  videoStreamKeys,
  WhepOutputNode,
  WhepOutputSettings,
} from "@norskvideo/norsk-sdk";
import { webRtcServerConfig } from "./common/webRtcServerConfig";

const allowedRenditions = {
  high: { bitrate: 800000 },
  medium: { bitrate: 500000 },
  low: { bitrate: 250000 },
};

const selectAVFromAllowed = (
  app: string,
  publishingName: string,
  streams: StreamMetadata[]
) => {
  const audio = audioStreamKeys(streams).filter(
    (k) => k.sourceName === app && k.renditionName === publishingName
  );
  const video = videoStreamKeys(streams).filter(
    (k) => k.sourceName === app && k.renditionName === publishingName
  );
  if (audio.length == 1 && video.length == 1) {
    return audio.concat(video);
  }
  return [];
};

const selectVideoFromAllowed = (
  app: string,
  publishingName: string,
  streams: StreamMetadata[]
) => {
  const video = videoStreamKeys(streams).filter(
    (k) => k.sourceName === app && k.renditionName === publishingName
  );
  if (video.length == 1) {
    return video;
  }
  return [];
};

const selectAudioFromAllowed = (
  app: string,
  publishingName: string,
  streams: StreamMetadata[]
) => {
  const audio = audioStreamKeys(streams).filter(
    (k) => k.sourceName === app && k.renditionName === publishingName
  );
  if (audio.length == 1) {
    return audio;
  }
  return [];
};

const subscribeAV = (
  source: RtmpServerInputNode,
  app: string,
  publishingName: string
) => {
  return {
    source,
    sourceSelector: (streams: StreamMetadata[]) =>
      selectAVFromAllowed(app, publishingName, streams),
  };
};

const subscribeVideo = (
  source: RtmpServerInputNode,
  app: string,
  publishingName: string
) => {
  return {
    source,
    sourceSelector: (streams: StreamMetadata[]) =>
      selectVideoFromAllowed(app, publishingName, streams),
  };
};

const subscribeAudio = (
  source: RtmpServerInputNode,
  app: string,
  publishingName: string
) => {
  return {
    source,
    sourceSelector: (streams: StreamMetadata[]) =>
      selectAudioFromAllowed(app, publishingName, streams),
  };
};

type App = {
  master: CmafMasterOutputNode;
  webrtc: WhepOutputNode[];
  sources: string[];
};
const knownApps: { [x: string]: App } = {};

const partDurationSeconds = 1.0;
const segmentDurationSeconds = 4.0;

export async function main() {
  const norsk = await Norsk.connect();

  const input = await norsk.input.rtmpServer({
    id: "rtmp",

    onConnection: (_cid: string, app: string, url: string) => {
      console.log("Got RTMP connection", app, url);
      return { accept: true }; // accept all!!!
    },

    onStream: (
      _cid: string,
      app: string,
      url: string,
      streamId: number,
      publishingName: string
    ) => {
      if (!(publishingName in allowedRenditions)) {
        return {
          accept: false,
          reason: "only known rendition names are accepted around here",
        };
      }

      console.log("Got RTMP stream", app, url, streamId, publishingName);
      const onStream = async () => {
        const destinations: CmafDestinationSettings[] = [{ type: "local", retentionPeriodSeconds: 10 }]
        // Register this app if we've not seen it before, and start up a master playlist for it
        if (!knownApps[app]) {
          const settings: CmafMasterOutputSettings = {
            id: "hls-master-" + app,
            playlistName: app,
            destinations,
          };
          const masterPlaylist = await norsk.output.cmafMaster(settings);
          knownApps[app] = { master: masterPlaylist, sources: [], webrtc: [] };
          console.log(`Local player: ${masterPlaylist.playlistUrl}`);
        }
        // Create a single WebRTC output for this new stream
        const webRtcOutput = await norsk.output.whep({
          id: "webrtc-" + app + "-" + publishingName,
          ...webRtcServerConfig
        });
        webRtcOutput.subscribe([subscribeAV(input, app, publishingName)]);
        knownApps[app].webrtc.push(webRtcOutput);
        console.log(`Local player: ${webRtcOutput.playerUrl}`);

        // Create a single audio HLS output for this new stream
        const audioOutput = await norsk.output.cmafAudio({
          id: "hls-" + app + "-" + publishingName + "-audio",
          partDurationSeconds,
          segmentDurationSeconds,
          destinations
        });
        audioOutput.subscribe([subscribeAudio(input, app, publishingName)]);

        // Create a single video HLS output for this new stream
        const videoOutput = await norsk.output.cmafVideo({
          id: "hls-" + app + "-" + publishingName + "-video",
          partDurationSeconds,
          segmentDurationSeconds,
          destinations,
        });
        videoOutput.subscribe([subscribeVideo(input, app, publishingName)]);

        // Add this to the list of renditions we know about
        knownApps[app].sources.push(publishingName);

        // And re-subscribe the master playlist to all of the known about renditions
        knownApps[app].master.subscribe(
          knownApps[app].sources.map((r) => subscribeAV(input, app, r))
        );
      };
      onStream();

      return {
        accept: true,
        // These are in fact the defaults
        audioStreamKey: {
          programNumber: 1,
          streamId: 1,
          sourceName: app,
          renditionName: publishingName,
        },
        videoStreamKey: {
          programNumber: 1,
          streamId: 2,
          sourceName: app,
          renditionName: publishingName,
        },
      };
    },
  });
}
