/**
 * Icon system: Lucide (vanilla) SVG icons, tree-shaken to the set we use.
 * Markup uses <i data-lucide="name"></i>; renderIcons() swaps them for SVGs.
 * Lucide adds aria-hidden="true" automatically; controls keep their aria-labels.
 */
import {
  createIcons,
  ArrowLeft,
  ArrowRight,
  AudioWaveform,
  ChevronUp,
  CircleDot,
  CloudRain,
  Dice5,
  Download,
  Info,
  Link,
  Maximize,
  Minimize,
  Moon,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  StepBack,
  StepForward,
  Timer,
  Triangle,
  Volume2,
  Waves,
  Wind,
  X,
} from 'lucide';

const ICONS = {
  ArrowLeft, ArrowRight, AudioWaveform, ChevronUp, CircleDot, CloudRain, Dice5, Download, Info, Link,
  Maximize, Minimize, Moon, Pause, Play, RotateCcw, SlidersHorizontal, StepBack, StepForward, Timer, Triangle,
  Volume2, Waves, Wind, X,
};

export function renderIcons(root = document) {
  createIcons({
    icons: ICONS,
    root,
    attrs: { width: 18, height: 18, 'stroke-width': 1.5, 'aria-hidden': 'true', focusable: 'false' },
  });
}
