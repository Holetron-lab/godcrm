FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends rsync && apt-get clean
USER 65534:65534
WORKDIR /work
ENTRYPOINT ["node"]
