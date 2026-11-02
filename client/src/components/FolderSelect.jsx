import { flattenFolders, folderPathName } from '../folders.js';

/** The options of a folder select: the tree in order, each named by its path. `exclude` is a set of ids to leave out. */
export function FolderOptions({ folders, exclude }) {
  return flattenFolders(folders)
    .filter(({ folder }) => !exclude?.has(folder.id))
    .map(({ folder }) => <option key={folder.id} value={folder.id}>{folderPathName(folder, folders, ' › ')}</option>);
}

/** A labelled select of folders (`value` is the id; `children` may add options before the folders, e.g. «none»). */
export default function FolderSelect({ label = 'Папка', folders, value, onChange, exclude, className = '', children }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {children}
        <FolderOptions folders={folders} exclude={exclude} />
      </select>
    </label>
  );
}
