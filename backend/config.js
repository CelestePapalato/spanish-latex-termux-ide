'use strict';
const path = require('path');
const os = require('os');

module.exports = {
  // Loopback only by default. Setting HOST to 0.0.0.0 exposes the editor to the network (not recommended).
  HOST: process.env.HOST || '127.0.0.1',
  PORT: parseInt(process.env.PORT || '3000', 10),
  PROJECTS_DIR: process.env.PROJECTS_DIR || path.join(os.homedir(), 'latex-projects'),
  PUBLIC_DIR: path.join(__dirname, '..', 'public'),
  // \write18 / minted etc. Off by default: a malicious .tex file could run arbitrary commands.
  SHELL_ESCAPE: process.env.LATEXIDE_SHELL_ESCAPE === '1',
  ALLOWED_HOSTS: (process.env.LATEXIDE_ALLOWED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
};
