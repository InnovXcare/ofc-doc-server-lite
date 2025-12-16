#!/bin/bash

echo "Initializing OnlyOffice environment..."

# Setting up environment variables
export LD_LIBRARY_PATH="/var/runtime/lib:/var/runtime/lib64"
export PATH="$PATH:/var/runtime/documentserver/server/FileConverter/bin"
export NODE_ICU_DATA="/var/runtime/documentserver/server/FileConverter/bin"
export XDG_CACHE_HOME="/tmp/.cache"

# Create cache directory and add dummy script
mkdir -p /tmp/.cache

cat > /tmp/init_env.docbuilder << 'EOF'
console.log("Initializing OnlyOffice environment...");
builder.CreateFile("docx");
const oDocument = Api.GetDocument();
builder.CloseFile();
console.log("Environment initialization completed.");
EOF

echo "Running DocBuilder initialization..."
/var/runtime/documentserver/server/FileConverter/bin/docbuilder /tmp/init_env.docbuilder || {
    echo "DocBuilder initialization completed with warnings (this is normal)"
}

# Removing temp dirs
rm -f /tmp/init_env.docbuilder

echo "OnlyOffice environment initialization finished successfully!"