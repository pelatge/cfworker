import json from '@rollup/plugin-json';
import replace from '@rollup/plugin-replace';
import EventEmitter from 'events';
import rollup from 'rollup';
import commonjs from 'rollup-plugin-commonjs';
import multiEntry from 'rollup-plugin-multi-entry';
import resolve from 'rollup-plugin-node-resolve';
import typescript from 'rollup-plugin-typescript2';
import { logger } from './logger.js';

export class Bundler extends EventEmitter {
  /** @type {import('rollup').RollupOptions} */
  inputOptions = {
    // @ts-ignore
    plugins: [
      replace({ values: this.envReplacements() }),
      multiEntry({ exports: false }),
      resolve(),
      commonjs(),
      json()
    ],
    onwarn: message => logger.warn(message.toString())
  };

  /** @type {import('rollup').OutputOptions} */
  outputOptions = {
    file: process.platform === 'win32' ? 'nul' : '/dev/null', // no way to prevent rollup.watch from writing to disk
    format: 'iife',
    globals: name => name
  };

  bundleStartTime = 0;

  dispose = () => {};

  /**
   * @param {string[]} globs
   * @param {boolean} watch
   * @param {string[]} external
   * @param {boolean} check
   */
  constructor(globs, watch, external = [], check = true) {
    super();
    this.inputOptions.input = globs;
    this.inputOptions.external = external;
    // add rollup-plugin-typescript2 when globs include typescript file extension
    if (globs.find(g => /\.ts(?:$|,)/.test(g))) {
      // @ts-ignore
      this.inputOptions.plugins.splice(
        2,
        0,
        typescript({
          check,
          include: ['*.ts', '**/*.ts', '../**/*.ts']
        })
      );
    }
    this.watch = watch;
    this.code = '';
    this.bundled = new Promise(resolve => (this.setBundled = resolve));
  }

  async bundle() {
    if (this.watch) {
      /** @type {import('rollup').RollupWatchOptions} */
      const watchOptions = {
        ...this.inputOptions,
        output: this.outputOptions
      };
      const watcher = rollup.watch([watchOptions]);
      this.dispose = () => watcher.close();
      watcher.on('event', async ({ code, result: bundle, error }) => {
        switch (code) {
          case 'ERROR':
            logger.error(error);
            this.emit('bundle-error', error);
            return;
          case 'BUNDLE_START':
            this.bundleStartTime = Date.now();
            logger.progress('Bundling...');
            this.emit('bundle-start');
            return;
          case 'BUNDLE_END':
            this.updateCode(bundle);
            return;
        }
      });
    } else {
      this.bundleStartTime = Date.now();
      logger.progress('Bundling...');
      this.emit('bundle-start');
      const bundle = await rollup.rollup(this.inputOptions);
      this.updateCode(bundle);
    }
    return this.bundled;
  }

  /**
   * @param {import('rollup').RollupBuild} bundle
   */
  async updateCode(bundle) {
    logger.progress('Generating bundle...');
    const { output } = await bundle.generate(this.outputOptions);
    this.code = output[0].code;
    logger.success(`Bundled`, Date.now() - this.bundleStartTime);
    this.emit('bundle-end');
    this.setBundled();
  }

  envReplacements() {
    /** @type {Record<string, string>} */
    const replacements = {};

    for (const [key, value] of Object.entries(process.env)) {
      replacements[`process.env.${key}`] = JSON.stringify(value);
    }

    return replacements;
  }
}