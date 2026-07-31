/*
 * Marks the Product-owned System Skills lifecycle seam. The atomic sync remains
 * invoked exclusively by Home initialization in home.ts.
 */
export type {
  MegumiHomeFileSystem,
  MegumiHomeResourceLocator,
  MegumiHomeSyncFileSystem,
} from './home';
