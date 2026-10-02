#!/bin/sh
# Package the extension as a zip/xpi for signing or installation.
set -e
cd "$(dirname "$0")/extension"
rm -f ../ilias-stay-signed-in.zip
zip -qr ../ilias-stay-signed-in.zip . -x '.*'
echo "Built ilias-stay-signed-in.zip"
