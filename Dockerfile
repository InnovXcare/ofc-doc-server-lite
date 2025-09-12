

# ==============================================================
# STAGE 1: Extracting from DocumentServer
# ==============================================================


# ***************************************************************** START OF STAGE 1 *********************************************************************



FROM onlyoffice/documentserver:latest AS extractor


# updating package repository + installing curl for health check + zip + cleaning up package cache to reduce layer size
RUN apt-get update && apt-get install -y \
    curl \
    zip \
    && rm -rf /var/lib/apt/lists/*


# creating a extraction directory for components to be copied in stage 2
RUN mkdir -p /extract

# Debug: Check what exists in the OnlyOffice container
RUN echo "=== CHECKING ONLYOFFICE STRUCTURE ===" && \
    ls -la /var/www/onlyoffice/ && \
    ls -la /var/www/onlyoffice/documentserver/ && \
    ls -la /var/www/onlyoffice/documentserver/server/ && \
    find /var/www/onlyoffice/documentserver/server -name "*.js" | head -10 && \
    echo "=== END CHECK ==="



# extract x2t and docbuilder binaries with dependencies
RUN cp -r /var/www/onlyoffice/documentserver/server/FileConverter/bin /extract/ && \
    # copying shared libraries and handling if stderr [file descriptor 2] to blackhole [NON BLOCKING]
    mkdir -p /extract/lib && \
    cp /var/www/onlyoffice/documentserver/server/FileConverter/bin/*.so* /extract/lib/ 2>/dev/null || true && \
    # copying fonts
    cp -r /usr/share/fonts /extract/ && \
    # searching OnlyOffice core fonts directory and for each match recursively copy the found directory + also handling if stderr [file descriptor 2] to blackhole [NON BLOCKING]
    find /var/www/onlyoffice -name "core-fonts" -type d -exec cp -r {} /extract/ \; 2>/dev/null || true && \
    # copying server components that we need to destination --> extract/server folder
    mkdir -p /extract/server/Common/sources && \
    mkdir -p /extract/server/DocService/sources && \
    # Copy specific Common source files
    cp /var/www/onlyoffice/documentserver/server/Common/sources/commondefines.js /extract/server/Common/sources/ 2>/dev/null || true && \
    cp /var/www/onlyoffice/documentserver/server/Common/sources/operationContext.js /extract/server/Common/sources/ 2>/dev/null || true && \
    cp /var/www/onlyoffice/documentserver/server/Common/sources/utils.js /extract/server/Common/sources/ 2>/dev/null || true && \
    cp /var/www/onlyoffice/documentserver/server/Common/sources/formatchecker.js /extract/server/Common/sources/ 2>/dev/null || true && \
    # Copy specific DocService source files
    cp /var/www/onlyoffice/documentserver/server/DocService/sources/constants.js /extract/server/DocService/sources/ 2>/dev/null || true && \
    cp /var/www/onlyoffice/documentserver/server/DocService/sources/utilsDocService.js /extract/server/DocService/sources/ 2>/dev/null || true && \
    # Copy any package.json files if they exist (for potential dependencies)
    cp /var/www/onlyoffice/documentserver/server/Common/package.json /extract/server/Common/ 2>/dev/null || true && \
    cp /var/www/onlyoffice/documentserver/server/DocService/package.json /extract/server/DocService/ 2>/dev/null || true && \
    # copying config files
    mkdir -p /extract/config && \
    cp -r /etc/onlyoffice/documentserver /extract/config/ 2>/dev/null || true

RUN echo "=== CHECKING EXTRACTED FILES ===" && \
    ls -la /extract/ && \
    ls -la /extract/server/ && \
    ls -la /extract/server/Common/ && \
    ls -la /extract/server/Common/sources/ && \
    ls -la /extract/server/DocService/ && \
    ls -la /extract/server/DocService/sources/ && \
    echo "=== END EXTRACTED CHECK ==="


# cleaning up unnecessary files to reduce size
RUN find /extract -name '*.log' -delete && \
    find /extract -name '*.tmp' -delete && \
    find /extract -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true



# ***************************************************************** END OF STAGE 1 *********************************************************************






# ======================================================
# STAGE 2: AWS Lambda Runtime
# ======================================================


# ***************************************************************** START OF STAGE 2 *********************************************************************



FROM public.ecr.aws/lambda/nodejs:22 AS lambda


# We can set any lambda specific envs here if required
ENV NODE_CONFIG_DIR=/var/task/config

# copying all extracted components from stage 1
COPY --from=extractor /extract/bin ${LAMBDA_RUNTIME_DIR}/bin
COPY --from=extractor /extract/lib ${LAMBDA_RUNTIME_DIR}/lib
COPY --from=extractor /extract/fonts ${LAMBDA_RUNTIME_DIR}/fonts
COPY --from=extractor /extract/core-fonts ${LAMBDA_RUNTIME_DIR}/core-fonts
COPY --from=extractor /extract/server ${LAMBDA_RUNTIME_DIR}/server
COPY --from=extractor /extract/config ${LAMBDA_RUNTIME_DIR}/config

# Debug: Check what was copied to the Lambda container
RUN echo "=== CHECKING LAMBDA CONTAINER STRUCTURE ===" && \
    ls -la /var/runtime/ && \
    ls -la /var/runtime/server/ && \
    ls -la /var/runtime/server/Common/ && \
    ls -la /var/runtime/server/Common/sources/ && \
    ls -la /var/runtime/server/DocService/ && \
    ls -la /var/runtime/server/DocService/sources/ && \
    echo "=== END LAMBDA CHECK ==="

# copying the lambda handlers and modules
COPY modules/ ${LAMBDA_TASK_ROOT}/modules
COPY index.js ${LAMBDA_TASK_ROOT}/index.js

# copying the config --> default.json [Assuming it will be same throughout the environments]
COPY config/default.json ${LAMBDA_TASK_ROOT}/config/default.json

# installing dependencies of common + docService only if package.json exists (much faster now with minimal files)
WORKDIR ${LAMBDA_RUNTIME_DIR}/server/Common
RUN if [ -f package.json ]; then npm install --omit=dev; else echo "No package.json in Common, skipping npm install"; fi

WORKDIR ${LAMBDA_RUNTIME_DIR}/server/DocService
RUN if [ -f package.json ]; then npm install --omit=dev; else echo "No package.json in DocService, skipping npm install"; fi


# copying package.json for lambda function
WORKDIR ${LAMBDA_TASK_ROOT}
COPY package.json .

# installing lambda specific dependencies
RUN npm install --omit=dev

# setting up library paths for lambda
# searches left --> right, first lib then bin  
ENV LD_LIBRARY_PATH=${LAMBDA_RUNTIME_DIR}/lib:${LAMBDA_RUNTIME_DIR}/bin:$LD_LIBRARY_PATH

# adding executables to files forcefully
RUN chmod +x ${LAMBDA_RUNTIME_DIR}/bin/*

# setting the lambda handler
CMD ["index.handler"]

# ***************************************************************** END OF STAGE 2 *********************************************************************
