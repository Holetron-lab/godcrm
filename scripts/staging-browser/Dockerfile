FROM 7412f6aca276d30c9ddb21e1d1718632269cf0ebc287c4d82993f0f1405bdaee
USER root
COPY --chown=0:0 node_modules /worker/node_modules
COPY --chown=0:0 suites.mjs visual.mjs metrics.mjs registry.json /worker/
USER 65534:65534
WORKDIR /worker
ENTRYPOINT ["node", "/worker/suites.mjs"]
