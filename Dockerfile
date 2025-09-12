

# ==============================================================
# STAGE 1: Extracting from DocumentServer
# ==============================================================


# ***************************************************************** START OF STAGE 1 *********************************************************************



FROM onlyoffice/documentserver:latest AS extractor


# updating package repository + installing curl for health check + zip + cleaning up package cache to reduce layer size
RUN apt-get update && apt-get install -y \
    curl \
    zip \
    && rm-rf /var/lib/apt/lists/*


# creating a extraction directory for components to be copied in stage 2
RUN mkdir -p /extract


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
    mkdir -p /extract/server && \
    cp -r /var/www/onlyoffice/documentserver/server/Common /extract/server/ && \
    cp -r /var/www/onlyoffice/documentserver/server/FileConverter /extract/server/ && \
    # copying config files
    mkdir -p /extract/config && \
    cp -r etc/onlyoffice/documentserver /extract/config/ 2>/dev/null || true


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
COPY --from=extractor /extractor/bin ${LAMBDA_RUNTIME_DIR}/bin
COPY --from=extractor /extractor/lib ${LAMBDA_RUNTIME_DIR}/lib
COPY --from=extractor /extractor/fonts ${LAMBDA_RUNTIME_DIR}/fonts
COPY --from=extractor /extractor/core-fonts ${LAMBDA_RUNTIME_DIR}/core-fonts
COPY --from=extractor /extractor/server %{LAMBDA_RUNTIME_DIR}/server
COPY --from=extractor /extractor/config ${LAMBDA_RUNTIME_DIR}/config

# copying the lambda handlers and modules
COPY modules/ ${LAMBDA_TASK_ROOT}/modules
COPY index.js ${LAMBDA_TASK_ROOT}/index.js

# copying the config --> default.json [Assuming it will be same throughout the environments]
COPY config/default.json ${LAMBDA_TASK_ROOT}/config/default.json

# installing node.js dependencies --> Common + FileConverter
WORKDIR ${LAMBDA_RUNTIME_DIR}/server/Common
RUN npm install --omit=dev

WORKDIR ${LAMBDA_RUNTIME_DIR}/server/FileConverter
RUN npm install --omit=dev

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
