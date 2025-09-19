# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
IMAGE_NAME="ofc-doc-server-lite"
CONTAINER_NAME="ofc-doc-server-dev"
PORT="9000:8080"
WATCH_DIRS="controller modules index.js config resources package.json Dockerfile"

# Function to print colored messages
print_message() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
}

# Function to cleanup existing container
cleanup_container() {
    print_message $YELLOW " Cleaning up existing container..."
    docker stop $CONTAINER_NAME 2>/dev/null && print_message $GREEN "Container stopped"
    docker rm $CONTAINER_NAME 2>/dev/null && print_message $GREEN "Container removed"
}

# Function to build Docker image
build_image() {
    print_message $YELLOW "Building Docker image..."
    if docker build -t $IMAGE_NAME .; then
        print_message $GREEN "Build successful"
        return 0
    else
        print_message $RED "Build failed"
        return 1
    fi
}

# Function to run container
run_container() {
    print_message $YELLOW "Starting container..."
    
    # Run container with volume mounts for development
    docker run --name $CONTAINER_NAME -d -p $PORT \
               -v "$(pwd)/samples":/var/task/samples \
               -v "$(pwd)/controller":/var/task/controller \
               -v "$(pwd)/data":/var/task/data \
               $IMAGE_NAME
    
    if [ $? -eq 0 ]; then
        print_message $GREEN "Container started on http://localhost:9000"
        print_message $BLUE "Container name: $CONTAINER_NAME"
        print_message $BLUE "Lambda endpoint: http://localhost:9000/2015-03-31/functions/function/invocations"
        return 0
    else
        print_message $RED "Failed to start container"
        return 1
    fi
}

# Function to build and run
build_and_run() {
    local is_restart=${1:-false}
    
    if [ "$is_restart" = true ]; then
        print_message $YELLOW "Change detected, rebuilding..."
    fi
    
    cleanup_container
    
    if build_image; then
        run_container
    fi
}

# Function to show container logs
show_logs() {
    print_message $BLUE "📋 Showing container logs (Ctrl+C to stop):"
    docker logs -f $CONTAINER_NAME
}

# Function to check if fswatch is available
check_fswatch() {
    if ! command -v fswatch &> /dev/null; then
        print_message $RED "fswatch is not installed"
        print_message $YELLOW "Install with: brew install fswatch (macOS) or apt-get install fswatch (Linux)"
        exit 1
    fi
}

# Function to handle script termination
cleanup_on_exit() {
    print_message $YELLOW "\nShutting down development environment..."
    cleanup_container
    print_message $GREEN "Goodbye!"
    exit 0
}

# Set up signal handlers
trap cleanup_on_exit SIGINT SIGTERM

# Parse command line arguments
case "${1:-}" in
    "build")
        build_image
        ;;
    "run")
        cleanup_container
        run_container
        ;;
    "logs")
        show_logs
        ;;
    "stop")
        cleanup_container
        ;;
    "restart")
        build_and_run true
        ;;
    "watch"|"")
        # Default behavior - watch and rebuild
        check_fswatch
        
        print_message $GREEN "Starting development environment..."
        print_message $BLUE "Watching: $WATCH_DIRS"
        
        # Initial build and run
        build_and_run false
        
        # Watch for changes
        print_message $YELLOW "Watching for file changes... (Press Ctrl+C to stop)"
        fswatch -o \
            --exclude='\.git' \
            --exclude='node_modules' \
            --exclude='\.DS_Store' \
            --exclude='\.dockerignore' \
            --exclude='README\.md' \
            --exclude='dev\.sh' \
            --exclude='run\.sh' \
            --exclude='watch-and-build\.sh' \
            --exclude='samples/' \
            --exclude='data/' \
            . | while read f; do
            build_and_run true
        done
        ;;
    "help"|"-h"|"--help")
        print_message $GREEN "Development Script for OFC Doc Server Lite"
        echo ""
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  watch     Start development with file watching (default)"
        echo "  build     Build Docker image only"
        echo "  run       Run container without building"
        echo "  restart   Restart container with rebuild"
        echo "  logs      Show container logs"
        echo "  stop      Stop and remove container"
        echo "  help      Show this help message"
        echo ""
        print_message $BLUE "Examples:"
        echo "  $0              # Start development with file watching"
        echo "  $0 watch        # Same as above"
        echo "  $0 build        # Build image only"
        echo "  $0 logs         # Show container logs"
        ;;
    *)
        print_message $RED "Unknown command: $1"
        print_message $YELLOW " Use '$0 help' to see available commands"
        exit 1
        ;;
esac