/* Defines source-language user summaries for stable Renderer error codes. */
export const errors = {
  generic: 'Something went wrong. Please try again.',
  settings_update_failed: 'Settings could not be saved.',
  settings_load_failed: 'Settings could not be loaded.',
  setup_incomplete: 'Setup completion could not be saved.',
  render_failed: 'Something could not be displayed.',
  app_render_failed: 'Something went wrong.',
  web_provider_required: 'Select a search provider.',
  web_base_url_required: 'Custom search requires a Base URL.',
  web_api_key_required: 'Enter an API key or configure the provider environment variable.',
} as const;
