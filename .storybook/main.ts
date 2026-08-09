import type { StorybookConfig } from "@storybook/nextjs";

/**
 * Storybook, pointed at the component layer.
 *
 * Stories live beside the components rather than in a parallel tree, so a
 * component and its examples move together and a deleted component cannot leave
 * an orphaned story behind.
 *
 * `@storybook/nextjs` rather than the plain React builder: the components import
 * `next/font` and `next/navigation`, and this framework stubs both. Without it
 * every story importing a Next module fails at build rather than at render,
 * which is a confusing way to find out.
 */
const config: StorybookConfig = {
  stories: ["../src/components/**/*.stories.@(ts|tsx)"],

  addons: [],

  framework: {
    name: "@storybook/nextjs",
    options: {},
  },

  // The app is entirely client-rendered below the page level, and stories only
  // ever mount components, so there is nothing for a server build to do.
  staticDirs: ["../public"],

  typescript: {
    // The components are plain typed functions; letting Storybook infer prop
    // tables from them keeps the docs honest without a second source of truth.
    reactDocgen: "react-docgen-typescript",
  },
};

export default config;
