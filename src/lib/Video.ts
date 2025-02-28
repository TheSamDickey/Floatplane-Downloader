import fs from "fs/promises";
import { execFile } from "child_process";
import { createWriteStream } from "fs";

import { settings } from "./helpers";

import sanitize from "sanitize-filename";
import builder from "xmlbuilder";

import type { BlogPost } from "floatplane/creator";
import type Request from "got/dist/source/core";

import type Channel from "./Channel";
import { fApi } from "./FloatplaneAPI";

export default class Video {
	public guid: BlogPost["guid"];
	public title: BlogPost["title"];
	public description: BlogPost["text"];
	public releaseDate: Date;
	public thumbnail: BlogPost["thumbnail"];

	public videoAttachments: BlogPost["videoAttachments"]

	public channel: Channel;

	public filePath: string;
	private folderPath: string;

	constructor(video: BlogPost, channel: Channel) {
		this.channel = channel;

		this.guid = video.guid;
		this.videoAttachments = video.videoAttachments;
		this.title = video.title;
		this.description = video.text;
		this.releaseDate = new Date(video.releaseDate);
		this.thumbnail = video.thumbnail;

		const YEAR = this.releaseDate.getFullYear();
		const MONTH = this.releaseDate.getMonth()>9?"0"+this.releaseDate.getMonth():this.releaseDate.getMonth(); // If the month is less than 10 pad it with a 0
		const fullPath = `${settings.filePathFormatting
			.replace(/%channelTitle%/g, this.channel.title)
			.replace(/%episodeNumber%/g, this.channel.lookupVideoDB(this.guid).episodeNo.toString())
			.replace(/%year%/g, YEAR.toString())
			.replace(/%month%/g, MONTH.toString())
			.replace(/%videoTitle%/g, this.title.replace(/ - /g, " ").replace(/\//g, " ").replace(/\\/g, " "))
		}`;
		this.folderPath = fullPath.split("/").slice(0, -1).join("/");
		this.filePath = `${this.folderPath}/${sanitize(fullPath.split("/").slice(-1)[0])}`;
	}

	get expectedSize(): number|undefined {
		return this.channel.lookupVideoDB(this.guid).expectedSize;
	}
	set expectedSize(expectedSize: number|undefined) {
		this.channel.lookupVideoDB(this.guid).expectedSize = expectedSize;
	}

	static getFileBytes = async (path: string): Promise<number> => (await fs.stat(path).catch(() => ({ size: -1 }))).size;

	public downloadedBytes = async (): Promise<number> => Video.getFileBytes(this.filePath);
	public isDownloaded = async (): Promise<boolean> => await this.isMuxed() || await this.downloadedBytes() === this.expectedSize;

	public muxedBytes = async (): Promise<number> => Video.getFileBytes(`${this.filePath}.mp4`);
	public isMuxed = async (): Promise<boolean> => await this.muxedBytes() === this.expectedSize;

	public async download (quality: string): Promise<Request> {
		if (await this.isDownloaded()) throw new Error(`Attempting to download "${this.title}" video already downloaded!`);

		// Make sure the folder for the video exists
		await fs.mkdir(this.folderPath, { recursive: true });

		// If downloading artwork is enabled download it
		if (settings.extras.downloadArtwork && this.thumbnail !== undefined) {
			fApi.got.stream(this.thumbnail.path).pipe(createWriteStream(`${this.filePath}.png`));
		} // Save the thumbnail with the same name as the video so plex will use it

		if (settings.extras.saveNfo) {
			const nfo = builder.create("episodedetails")
				.ele("title").text(this.title).up()
				.ele("showtitle").text(this.channel.title).up()
				.ele("description").text(this.description).up()
				.ele("aired").text(this.releaseDate.toString()).up()
				.ele("season").text("1").up()
				.ele("episode").text(this.channel.lookupVideoDB(this.guid).episodeNo.toString()).up()
				.end({ pretty: true });
			await fs.writeFile(`${this.filePath}.nfo`, nfo, "utf8");
		}
		
		// Handle download resumption if video was partially downloaded
		const downloadedBytes = await this.downloadedBytes();
		const [writeStreamOptions, requestOptions] = downloadedBytes !== -1 ? [
			{ start: downloadedBytes, flags: "r+" },
			{ headers: { range: `bytes=${downloadedBytes}-${this.expectedSize}` } }
		] : [
			undefined,
			undefined
		];

		// Send download request video, assume the first video attached is the actual video as most will not have more than one video
		const cdnInfo = await fApi.cdn.delivery("download", this.videoAttachments[0]);

		// Pick a random edge to download off, eventual even distribution
		const downloadEdge = cdnInfo.edges[Math.floor(Math.random() * cdnInfo.edges.length)];

		// Convert the qualities into an array of resolutions
		const avalibleQualities = cdnInfo.resource.data.qualityLevels.map(quality => quality.name);

		// Set the quality to use based on whats given in the settings.json or the highest avalible
		const downloadQuality = avalibleQualities.includes(quality) ? quality : avalibleQualities[avalibleQualities.length-1];

		const downloadRequest = fApi.got.stream(`https://${downloadEdge.hostname}${cdnInfo.resource.uri.replace("{qualityLevels}", downloadQuality).replace("{token}", cdnInfo.resource.data.token)}`, requestOptions);
		// Pipe the download to the file once response starts
		downloadRequest.pipe(createWriteStream(`${this.filePath}`, writeStreamOptions));
		// Set the videos expectedSize once we know how big it should be for download validation.
		if (this.expectedSize === undefined) downloadRequest.once("downloadProgress", progress => this.expectedSize = progress.total);
		
		return downloadRequest;
	}

	public async markCompleted(): Promise<void> {
		if (!await this.isMuxed()) throw new Error(`Cannot mark ${this.title} as completed as video file size is not correct. Expected: ${this.expectedSize} bytes, Got: ${await this.muxedBytes()} bytes...`);
		return this.channel.markVideoCompleted(this.guid, this.releaseDate.toString());
	}

	public async muxffmpegMetadata (): Promise<void> {
		if (!this.isDownloaded()) throw new Error(`Cannot mux ffmpeg metadata for ${this.title} as its not downloaded. Expected: ${this.expectedSize}, Got: ${await this.downloadedBytes()} bytes...`);
		await new Promise((resolve, reject) => execFile(
			"./db/ffmpeg", 
			[
				"-i",
				this.filePath,
				"-metadata", 
				`title=${this.title}`, 
				"-metadata", 
				`AUTHOR=${this.channel.title}`, 
				"-metadata", 
				`YEAR=${this.releaseDate}`, 
				"-metadata", 
				`description=${this.description}`, 
				"-metadata", 
				`synopsis=${this.description}`, 
				"-c:a",
				"copy", 
				"-c:v", 
				"copy",
				`${this.filePath}.mp4`
			], (error, stdout) => {
				if (error !== null) reject(error);
				else resolve(stdout);
			}
		));
		this.expectedSize = await this.muxedBytes();
		await this.markCompleted();
		await fs.unlink(this.filePath);
		// Set the files update time to when the video was released
		await fs.utimes(`${this.filePath}.mp4`, new Date(), this.releaseDate);
	}
}