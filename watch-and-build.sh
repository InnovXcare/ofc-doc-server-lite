RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
IMAGE_NAME="ofc-doc-server-lite"
CONTAINER_NAME="ofc-doc-server-dev"
PORT="9000:8080"

# Function to build and run
build_and_run() {
    echo -e "${YELLOW} Change detected, rebuilding...${NC}"
    
    # Stop existing container
    docker stop $CONTAINER_NAME 2>/dev/null || true
    docker rm $CONTAINER_NAME 2>/dev/null || true
    
    # Build new image
    echo -e "${YELLOW}🏗️  Building Docker image...${NC}"
    if docker build -t $IMAGE_NAME .; then
        echo -e "${GREEN} Build successful${NC}"
        
        # Run container
        echo -e "${YELLOW}🚀 Starting container...${NC}"
        docker run --rm --name $CONTAINER_NAME -p $PORT $IMAGE_NAME &
        echo -e "${GREEN} Container started on http://localhost:9000${NC}"
    else
        echo -e "${RED} Build failed${NC}"
    fi
}

# Initial build
echo -e "${GREEN} Starting development watcher...${NC}"
build_and_run

# Watch for changes
echo -e "${YELLOW} Watching for file changes...${NC}"
fswatch -o \
    --exclude='\.git' \
    --exclude='node_modules' \
    --exclude='\.DS_Store' \
    --exclude='\.dockerignore' \
    --exclude='README\.md' \
    --exclude='watch-and-build\.sh' \
    . | while read f; do
    build_and_run
done
