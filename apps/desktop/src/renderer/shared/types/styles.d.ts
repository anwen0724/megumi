/* Allows Vite-managed stylesheets to be loaded through the minimal dynamic bootstrap. */
declare module '*.css';
declare module '*.ico' {
  const url: string;
  export default url;
}
