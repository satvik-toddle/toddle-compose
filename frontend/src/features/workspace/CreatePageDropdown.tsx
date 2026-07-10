import type { ReactElement } from 'react';
import { Dropdown, DropdownMenu } from '@toddle-edu/ds-web';
import type { DocumentType } from '../../types/api';
import { PAGE_TYPES } from './pageTypes';

type Placement = 'bottomLeft' | 'bottomRight' | 'topLeft' | 'topRight';

type CreatePageDropdownProps = {
  children: ReactElement; // the trigger; antd attaches the open handler to it
  onCreate: (type: DocumentType) => void;
  placement?: Placement;
  disabled?: boolean;
};

const options = PAGE_TYPES.map((p) => ({
  key: p.type,
  label: p.label,
  subText: p.description,
  icon: <p.Icon size="small" />,
}));

// Wraps a "new page" trigger in a Doc/Sheet picker; picking an option creates that page kind.
export function CreatePageDropdown({
  children,
  onCreate,
  placement,
  disabled,
}: Readonly<CreatePageDropdownProps>) {
  return (
    <Dropdown
      placement={placement}
      disabled={disabled}
      overlay={
        <DropdownMenu
          dsVersion="2.0"
          options={options}
          onClick={(option: { key: string }) => onCreate(option.key as DocumentType)}
        />
      }
    >
      {children}
    </Dropdown>
  );
}
