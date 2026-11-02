import chat0 from "./locales/en/chat.json";
import onboarding0 from "./locales/en/onboarding.json";
import workspace0 from "./locales/en/workspace.json";
import settings0 from "./locales/en/settings.json";
import common0 from "./locales/en/common.json";
import computer0 from "./locales/en/computer.json";
import automation0 from "./locales/en/automation.json";
import git0 from "./locales/en/git.json";
// Lattice overlay: copy that exists only in Lattice's adaptations of the embedded panel.
import lattice0 from "./locales/en/lattice.json";
import chat1 from "./locales/es/chat.json";
import onboarding1 from "./locales/es/onboarding.json";
import workspace1 from "./locales/es/workspace.json";
import settings1 from "./locales/es/settings.json";
import common1 from "./locales/es/common.json";
import computer1 from "./locales/es/computer.json";
import automation1 from "./locales/es/automation.json";
import git1 from "./locales/es/git.json";
import lattice1 from "./locales/es/lattice.json";
import chat2 from "./locales/zh-CN/chat.json";
import onboarding2 from "./locales/zh-CN/onboarding.json";
import workspace2 from "./locales/zh-CN/workspace.json";
import settings2 from "./locales/zh-CN/settings.json";
import common2 from "./locales/zh-CN/common.json";
import computer2 from "./locales/zh-CN/computer.json";
import automation2 from "./locales/zh-CN/automation.json";
import git2 from "./locales/zh-CN/git.json";
import lattice2 from "./locales/zh-CN/lattice.json";
export const uiLocalizationResources = {
  en: {
    chat: chat0,
    onboarding: onboarding0,
    workspace: workspace0,
    settings: settings0,
    common: common0,
    computer: computer0,
    automation: automation0,
    git: git0,
    lattice: lattice0,
  },
  es: {
    chat: chat1,
    onboarding: onboarding1,
    workspace: workspace1,
    settings: settings1,
    common: common1,
    computer: computer1,
    automation: automation1,
    git: git1,
    lattice: lattice1,
  },
  "zh-CN": {
    chat: chat2,
    onboarding: onboarding2,
    workspace: workspace2,
    settings: settings2,
    common: common2,
    computer: computer2,
    automation: automation2,
    git: git2,
    lattice: lattice2,
  },
} as const;
