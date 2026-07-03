import type { ComponentType } from 'react';
import { OutlinedIcons } from '@toddle-edu/ds-icons';
import type { SystemIconProps } from '@toddle-edu/ds-icons';

// The exact set of outlined icons the design uses (all verified present).
// One seam so the rest of the app never imports ds-icons directly.
export const ICONS = {
  AddOutlined: OutlinedIcons.AddOutlined,
  PencilOutlined: OutlinedIcons.PencilOutlined,
  DeleteOutlined: OutlinedIcons.DeleteOutlined,
  ChevronDownOutlined: OutlinedIcons.ChevronDownOutlined,
  ChevronRightOutlined: OutlinedIcons.ChevronRightOutlined,
  ChevronLeftOutlined: OutlinedIcons.ChevronLeftOutlined,
  EyeOutlined: OutlinedIcons.EyeOutlined,
  CommentOutlined: OutlinedIcons.CommentOutlined,
  SettingsOutlined: OutlinedIcons.SettingsOutlined,
  DashboardOutlined: OutlinedIcons.DashboardOutlined,
  BoltOutlined: OutlinedIcons.BoltOutlined,
  StarOutlined: OutlinedIcons.StarOutlined,
  LockOutlined: OutlinedIcons.LockOutlined,
  GlobeOutlined: OutlinedIcons.GlobeOutlined,
  SendOutlined: OutlinedIcons.SendOutlined,
  TickSmallOutlined: OutlinedIcons.TickSmallOutlined,
  TickCircleOutlined: OutlinedIcons.TickCircleOutlined,
  WarningTriangleOutlined: OutlinedIcons.WarningTriangleOutlined,
  MultipleUsersOutlined: OutlinedIcons.MultipleUsersOutlined,
  BellRingOutlined: OutlinedIcons.BellRingOutlined,
  FolderOutlined: OutlinedIcons.FolderOutlined,
  // Document/page icon for the Pages tree. Aliased to a ds page icon (ds-icons
  // has no plain "FileOutlined"); swap the target here to restyle every doc icon.
  FileOutlined: OutlinedIcons.PageFoldPortraitOutlined,
  SearchOutlined: OutlinedIcons.SearchOutlined,
  InformationOutlined: OutlinedIcons.InformationOutlined,
  EmailOutlined: OutlinedIcons.EmailOutlined,
  UserProfileOutlined: OutlinedIcons.UserProfileOutlined,
  CloseOutlined: OutlinedIcons.CloseOutlined,
  DotsHorizontalOutlined: OutlinedIcons.DotsHorizontalOutlined,
  HelpOutlined: OutlinedIcons.HelpOutlined,
  HomeOutlined: OutlinedIcons.HomeOutlined,
  ShareOutlined: OutlinedIcons.ShareOutlined,
  FilterOutlined: OutlinedIcons.FilterOutlined,
  HamburgerOutlined: OutlinedIcons.HamburgerOutlined,
  GridOutlined: OutlinedIcons.GridOutlined,
  ImageSquareOutlined: OutlinedIcons.ImageSquareOutlined,
  KeyDiagonalOutlined: OutlinedIcons.KeyDiagonalOutlined,
  CopyOutlined: OutlinedIcons.CopyOutlined,
} as unknown as Record<string, ComponentType<SystemIconProps>>;

export type IconName = keyof typeof ICONS;
