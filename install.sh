#!/bin/bash
set -e

# TODO: Could replace this with Lerna https://github.com/lerna/lerna

# Install packages
# (cd node-definitions; yarn) # nothing to install yet
(cd dynamic-runtime; yarn)
(cd scripted-demos; yarn)
(cd patcher; yarn)

# Add symlinks
ln -sf ../../node-definitions patcher/node_modules
ln -sf ../../dynamic-runtime patcher/node_modules

ln -sf ../../node-definitions scripted-demos/node_modules
ln -sf ../../dynamic-runtime scripted-demos/node_modules
