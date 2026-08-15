import { writable } from 'svelte/store';

import type KindlePlugin from '~/.';
import { ee } from '~/eventEmitter';
import type { AmazonAccountRegion, SyncMode } from '~/models';

type Settings = {
  amazonRegion: AmazonAccountRegion;
  highlightsFolder: string;
  lastSyncDate?: Date;
  lastSyncMode: SyncMode;
  hasStartedSync?: boolean;
  isLoggedIn: boolean;
  fileTemplate?: string;
  highlightTemplate?: string;
  fileNameTemplate?: string;
  syncOnBoot: boolean;
  downloadBookMetadata: boolean;
  ignoredBooks: string[];

  // Frontmatter property name on a synced book note that, when truthy,
  // excludes that book from all future syncs
  ignorePropertyName?: string;

  // Frontmatter property name on a synced book note that tracks reading
  // status (e.g. "Status"), paired with the value that means "finished" -
  // when a book's file has this property set to statusCompletedValue, it is
  // excluded from resync (no new highlights will be appended)
  statusPropertyName?: string;
  statusCompletedValue?: string;

  // Note values (e.g. ".h1", ".h2") that mark a highlight as a new section
  // (chapter) start. A real blank line is inserted before such highlights
  // when rendering, and the value is also exposed to templates as
  // `sectionMarkerNotes` for conditional formatting.
  sectionMarkerNotes: string[];

  // Deprecated - delete eventually
  noteTemplate?: string;
  history?: string;
};

const DEFAULT_SETTINGS: Settings = {
  amazonRegion: 'global',
  highlightsFolder: '/',
  lastSyncMode: 'amazon',
  hasStartedSync: false,
  isLoggedIn: false,
  syncOnBoot: false,
  downloadBookMetadata: true,
  ignoredBooks: [],
  sectionMarkerNotes: [],
};

const createSettingsStore = () => {
  const store = writable(DEFAULT_SETTINGS);

  let _plugin!: KindlePlugin;

  // Load settings data from disk into store
  const initialize = async (plugin: KindlePlugin): Promise<void> => {
    const data = Object.assign({}, DEFAULT_SETTINGS, await plugin.loadData()) as Settings;

    const settings: Settings = {
      ...data,
      lastSyncDate: data.lastSyncDate ? new Date(data.lastSyncDate) : undefined,
    };

    store.set(settings);

    _plugin = plugin;
  };

  ee.on('resyncComplete', () => {
    store.update((state) => {
      state.lastSyncDate = new Date();
      return state;
    });
  });

  ee.on('syncSessionStart', (mode) => {
    store.update((state) => {
      state.lastSyncMode = mode;
      state.hasStartedSync = true;
      return state;
    });
  });

  ee.on('syncSessionSuccess', () => {
    store.update((state) => {
      state.lastSyncDate = new Date();
      return state;
    });
  });

  // Listen to any change to store, and write to disk
  store.subscribe((settings) => {
    if (_plugin) {
      // Transform settings fields for serialization
      const data = {
        ...settings,
        lastSyncDate: settings.lastSyncDate ? settings.lastSyncDate.toJSON() : undefined,
      };

      _plugin
        .saveData(data)
        .catch((err) => console.error(`Error saving settings: ${String(err)}`));
    }
  });

  const setHighlightsFolder = (value: string) => {
    store.update((state) => {
      state.highlightsFolder = value;
      return state;
    });
  };

  const login = () => {
    store.update((state) => {
      state.isLoggedIn = true;
      return state;
    });
  };

  const logout = () => {
    store.update((state) => {
      state.isLoggedIn = false;
      return state;
    });
  };

  const setHighlightTemplate = (value: string) => {
    store.update((state) => {
      state.highlightTemplate = value;
      return state;
    });
  };

  const setFileTemplate = (value: string) => {
    store.update((state) => ({ ...state, fileTemplate: value }));
  };

  const setFileNameTemplate = (value: string) => {
    store.update((state) => ({ ...state, fileNameTemplate: value }));
  };

  const setSyncOnBoot = (value: boolean) => {
    store.update((state) => {
      state.syncOnBoot = value;
      return state;
    });
  };

  const setDownloadBookMetadata = (value: boolean) => {
    store.update((state) => {
      state.downloadBookMetadata = value;
      return state;
    });
  };

  const setAmazonRegion = (value: AmazonAccountRegion) => {
    store.update((state) => {
      state.amazonRegion = value;
      return state;
    });
  };

  const setIgnoredBooks = (value: string[]) => {
    store.update((state) => {
      state.ignoredBooks = value;
      return state;
    });
  };

  const setIgnorePropertyName = (value: string) => {
    store.update((state) => {
      state.ignorePropertyName = value;
      return state;
    });
  };

  const setStatusPropertyName = (value: string) => {
    store.update((state) => {
      state.statusPropertyName = value;
      return state;
    });
  };

  const setStatusCompletedValue = (value: string) => {
    store.update((state) => {
      state.statusCompletedValue = value;
      return state;
    });
  };

  const setSectionMarkerNotes = (value: string[]) => {
    store.update((state) => {
      state.sectionMarkerNotes = value;
      return state;
    });
  };

  return {
    store,
    subscribe: store.subscribe,
    initialize,
    actions: {
      setHighlightsFolder,
      login,
      logout,
      setFileTemplate,
      setFileNameTemplate,
      setHighlightTemplate,
      setSyncOnBoot,
      setDownloadBookMetadata,
      setAmazonRegion,
      setIgnoredBooks,
      setIgnorePropertyName,
      setStatusPropertyName,
      setStatusCompletedValue,
      setSectionMarkerNotes,
    },
  };
};

export const settingsStore = createSettingsStore();
