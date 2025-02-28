
export type Resolution = "360" | "720" | "1080" | "2160";
export type Resolutions = ["360", "720", "1080", "2160"];

import type { BlogPost } from "floatplane/creator";

export type ChannelOptions = {
	title: string;
	skip: boolean;
	identifiers: Array<{
		check: string;
		type: keyof BlogPost | "description";
	}> | false;
	consoleColor?: string;
};

export type SubChannels = {
	_default: ChannelOptions;
	[key: string]: ChannelOptions;
};

export type PlexSections = Array<{ server: string, section: string }>;
export type PlexSettings = {
	sectionsToUpdate: PlexSections,
	enabled: boolean;
	token: string;
}

export type Extras = { [key: string]: boolean }

export type SubscriptionSettings = {
	creatorId: string;
	plan: string;
	skip: boolean;
	channels: SubChannels;
}

export type Args = {
	username: string;
	password: string;
	token: string;
	headless: boolean;
	plexUsername: string;
	plexPassword: string;
}

export type PartialArgs = Partial<Args & Settings>;

export type Settings = {
	runQuickstartPrompts: boolean;
	downloadThreads: number;
	floatplane: {
		videoResolution: Resolution;
		videosToSearch: number;
		waitForNewVideos: boolean;
		_avalibleResolutions: Resolutions;
	};
	_filePathFormattingOPTIONS: string[];
	filePathFormatting: string;
	extras: Extras;
	channelAliases: { 
		[key: string]: string 
	};
	subscriptions: {
		[key: string]: SubscriptionSettings;
	};
	plex: PlexSettings;
};
