# #!/bin/bash

# echo "Running sample.docbuilder from samples directory..."
# docker run --rm \
#   --entrypoint="" \
#   -v $(pwd)/samples:/var/task/samples \
#   -v $(pwd):/var/task \
#   -e NODE_CONFIG_DIR=/var/task/config \
#   -e LD_LIBRARY_PATH=/var/runtime/lib:/var/runtime/bin \
#   -e ONLYOFFICE_CORE_FONTS_PATH=/var/runtime/core-fonts \
#   ofc-doc-server-lite \
#   sh -c "echo 'Container started. Setting up environment...' && \
#          export HOME=/tmp && \
#          export TMPDIR=/tmp && \
#          mkdir -p /tmp && \
#          echo 'Listing samples:' && ls -la /var/task/samples/ && \
#          echo 'Running docbuilder with proper environment...' && \
#          cd /var/task/samples && \
#          /var/runtime/bin/docbuilder --check-fonts=0 --save-use-only-names=/var/task/samples sample.docbuilder"

#!/bin/bash

echo "Running sample.docbuilder via Lambda handler..."
docker run --rm \
  --entrypoint="" \
  -v $(pwd)/samples:/var/task/samples \
  -v $(pwd):/var/task \
  -e NODE_CONFIG_DIR=/var/task/config \
  ofc-doc-server-lite \
  node -e "
    const handler = require('/var/task/index.js').handler;
    const event = {
      'builderParams': {
        'argument': {},
        'builderPath': '/var/task/samples/sample.docbuilder'
      },
      'key': 'docbuilder-test'
    };
    const context = { getRemainingTimeInMillis: () => 300000 };
    
    handler(event, context)
      .then(result => {
        console.log('Result:', JSON.stringify(result, null, 2));
      })
      .catch(err => {
        console.error('Error:', err.message);
        console.error('Stack:', err.stack);
      });
  "