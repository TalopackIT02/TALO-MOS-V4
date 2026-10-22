import { DataInspectorScreen } from './DataInspectorScreen';

// DATA_INSPECTOR — frontend entry of the package (module.json "frontendEntry"): `screens` maps each screenKey of
// module.json to its component ({ tab, onSessionLost }). The screen is opened from the Foundation menu (B09, IAM
// filtered); whether the user may read anything is decided by the server on every request.

export const screens = { 'data.inspector': DataInspectorScreen };
