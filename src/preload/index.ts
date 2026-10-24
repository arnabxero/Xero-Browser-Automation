import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { EVENTS, type XeroApi } from '../shared/api';

const inv =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args);

function on<T>(channel: string) {
  return (cb: (payload: T) => void) => {
    const handler = (_e: IpcRendererEvent, payload: T) => cb(payload);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  };
}

const api: XeroApi = {
  app: {
    info: inv('app:info'),
    openExternal: inv('app:openExternal'),
    openPath: inv('app:openPath'),
    showInFolder: inv('app:showInFolder'),
    detectBrowsers: inv('app:detectBrowsers'),
    installChromium: inv('app:installChromium'),
    onInstallProgress: on(EVENTS.install),
    chooseFiles: inv('app:chooseFiles'),
    chooseExecutable: inv('app:chooseExecutable'),
    setTitleBarTheme: inv('app:setTitleBarTheme'),
    onNavigate: on(EVENTS.navigate),
    revealDataFolder: inv('app:revealDataFolder'),
  } as XeroApi['app'],
  settings: {
    get: inv('settings:get'),
    update: inv('settings:update'),
    onChange: on(EVENTS.settings),
  } as XeroApi['settings'],
  flows: {
    list: inv('flows:list'),
    get: inv('flows:get'),
    save: inv('flows:save'),
    create: inv('flows:create'),
    delete: inv('flows:delete'),
    duplicate: inv('flows:duplicate'),
    importFiles: inv('flows:importFiles'),
    exportFile: inv('flows:exportFile'),
    onChange: on(EVENTS.flows),
  } as XeroApi['flows'],
  live: {
    start: inv('live:start'),
    record: inv('live:record'),
    pause: inv('live:pause'),
    resume: inv('live:resume'),
    stopRecording: inv('live:stopRecording'),
    close: inv('live:close'),
    getState: inv('live:getState'),
    play: inv('live:play'),
    playControl: inv('live:playControl'),
    pick: inv('live:pick'),
    cancelPick: inv('live:cancelPick'),
    highlight: inv('live:highlight'),
    testTarget: inv('live:testTarget'),
    saveSession: inv('live:saveSession'),
    forget: inv('live:forget'),
    addAssertion: inv('live:addAssertion'),
    onEvent: on(EVENTS.live),
  } as XeroApi['live'],
  runs: {
    start: inv('runs:start'),
    stop: inv('runs:stop'),
    pause: inv('runs:pause'),
    resume: inv('runs:resume'),
    list: inv('runs:list'),
    get: inv('runs:get'),
    delete: inv('runs:delete'),
    clear: inv('runs:clear'),
    peek: inv('runs:peek'),
    exportReport: inv('runs:exportReport'),
    onEvent: on(EVENTS.runs),
  } as XeroApi['runs'],
  datasets: {
    list: inv('datasets:list'),
    get: inv('datasets:get'),
    save: inv('datasets:save'),
    delete: inv('datasets:delete'),
    importFile: inv('datasets:importFile'),
    exportCsv: inv('datasets:exportCsv'),
    exportRows: inv('datasets:exportRows'),
    onChange: on(EVENTS.datasets),
  } as XeroApi['datasets'],
  schedules: {
    list: inv('schedules:list'),
    save: inv('schedules:save'),
    delete: inv('schedules:delete'),
    runNow: inv('schedules:runNow'),
    onChange: on(EVENTS.schedules),
  } as XeroApi['schedules'],
  sessions: {
    list: inv('sessions:list'),
    rename: inv('sessions:rename'),
    delete: inv('sessions:delete'),
    onChange: on(EVENTS.sessions),
  } as XeroApi['sessions'],
};

contextBridge.exposeInMainWorld('xero', api);
