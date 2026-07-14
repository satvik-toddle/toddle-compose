import { useMemo, type ComponentType, type ReactElement } from 'react';
import { SelectDropdown } from '@toddle-edu/ds-web';
import { Loader } from './Loader';
import { isForbidden } from '../lib/errors';
import type { PublicUser } from '../types/api';

// The version-switching selector's union type drops react-select props (isMulti/value/onChange); use it untyped like components/RoleSelect.tsx does.
const Select = SelectDropdown as unknown as ComponentType<Record<string, unknown>>;

// One selectable realm user; `email` rides along for the grant / add-member call.
export interface UserOption {
  value: string;
  label: string;
  subtitle: string;
  icon: ReactElement;
  email: string;
}

// Props shared by the single- and multi-select variants.
interface UserPickerBaseProps {
  users: PublicUser[];
  isSearching: boolean;
  searchError: unknown;
  term: string;
  onTermChange: (term: string) => void;
  excludeIds: Set<string> | string[];
  renderAvatar: (user: PublicUser) => ReactElement;
  placeholder: string;
  // Shown once a term is typed but nothing matches (org/realm wording differs per caller).
  noMatchText: string;
  testId: string;
  size?: 'small' | 'medium';
  isSearchable?: boolean;
  isClearable?: boolean;
  // Renders the field in its error state without adding help text.
  showError?: boolean;
}

// Discriminated so single vs multi stays type-safe at each call site.
type UserPickerProps = UserPickerBaseProps &
  (
    | { isMulti: true; value: UserOption[]; onChange: (opts: UserOption[]) => void }
    | { isMulti?: false; value: UserOption | null; onChange: (opt: UserOption | null) => void }
  );

// Realm/user people-picker shared by DocPermissionsModal and AddWorkspaceMemberModal.
// The parent owns its own search hook + term state and feeds results down as props.
export function UserPicker(props: UserPickerProps) {
  const {
    users,
    isSearching,
    searchError,
    term,
    onTermChange,
    excludeIds,
    renderAvatar,
    placeholder,
    noMatchText,
    testId,
    size,
    isSearchable,
    isClearable,
    showError,
  } = props;

  const excluded = useMemo(
    () => (excludeIds instanceof Set ? excludeIds : new Set(excludeIds)),
    [excludeIds],
  );

  const options = useMemo(
    () =>
      users
        .filter((u) => !excluded.has(u.id))
        .map(
          (u): UserOption => ({
            value: u.id,
            label: u.name,
            subtitle: u.email,
            icon: renderAvatar(u),
            email: u.email,
          }),
        ),
    [users, excluded, renderAvatar],
  );

  const noOptionsText = searchError
    ? isForbidden(searchError)
      ? "You can't search people in this org"
      : "Couldn't search people"
    : term.trim()
      ? noMatchText
      : 'No people to suggest';

  return (
    <Select
      dsVersion="2.0"
      isMulti={props.isMulti ?? false}
      options={options}
      value={props.value}
      onChange={(next: UserOption | UserOption[] | null) => {
        // Results are already server-filtered (name OR email); a default label filter would drop email matches.
        if (props.isMulti) props.onChange((next as UserOption[] | null) ?? []);
        else props.onChange((next as UserOption | null) ?? null);
      }}
      onSearchTextChange={onTermChange}
      filterOption={null}
      isSearchable={isSearchable}
      isClearable={isClearable}
      placeholder={placeholder}
      noOptionsText={noOptionsText}
      loader={isSearching ? <Loader size={18} label="Searching" /> : undefined}
      size={size}
      testId={testId}
      error={showError ? ' ' : undefined}
    />
  );
}
