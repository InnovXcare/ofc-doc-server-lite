# ==============================================================
# STAGE 1: Extracting from DocumentServer
# ==============================================================


# ******** START OF STAGE 1 ********

FROM onlyoffice/documentserver:latest AS extractor


# updating package repository + installing curl for health check + zip + cleaning up package cache to reduce layer size
RUN apt-get update && apt-get install -y \
    curl \
    zip \
    && rm -rf /var/lib/apt/lists/*

COPY data/external-fonts /usr/share/fonts
RUN cp -r /var/www/onlyoffice/documentserver/core-fonts /usr/share/fonts
RUN sh /usr/bin/documentserver-generate-allfonts.sh


# ******** END OF STAGE 1 *********


# ======================================================
# STAGE 2: AWS Lambda Runtime
# ======================================================


# ************ START OF STAGE 2 ******************



FROM public.ecr.aws/lambda/nodejs:22 AS lambda


# We can set any lambda specific envs here if required
ENV NODE_CONFIG_DIR=/var/task/config

# copying all extracted components from stage 1 [fileConverters, fonts, sdkjs]
COPY --from=extractor /var/www/onlyoffice/documentserver/server/FileConverter/bin ${LAMBDA_RUNTIME_DIR}/documentserver/server/FileConverter/bin
COPY --from=extractor /var/www/onlyoffice/documentserver/sdkjs ${LAMBDA_RUNTIME_DIR}/documentserver/sdkjs

COPY --from=extractor /usr/share/fonts/ /usr/share/fonts/

#copying packageJson file
COPY package.json ${LAMBDA_TASK_ROOT}/package.json



# copying package.json for lambda function
WORKDIR ${LAMBDA_TASK_ROOT}
RUN if [ -f package.json ]; then npm install --omit=dev; else echo "No package.json in task root, skipping npm install"; fi


# copying the lambda handlers and modules
COPY server ${LAMBDA_TASK_ROOT}/server
COPY index.js ${LAMBDA_TASK_ROOT}

# copying CONFIG file
COPY server/config/default.json ${LAMBDA_TASK_ROOT}/config/default.json


CMD ["index.handler"]
# ***************************************************************** END OF STAGE 2 *********************************************************************