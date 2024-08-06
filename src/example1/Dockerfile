FROM ubuntu
RUN apt-get update && apt-get install  -y build-essential pip net-tools iputils-ping iproute2 curl
RUN curl -fsSL https://deb.nodesource.com/setup_16.x | bash -
RUN apt-get install -y nodejs
WORKDIR /usr/src
COPY . /usr/src
RUN npm install -g watchify
RUN npm i
EXPOSE 4000
EXPOSE 10000-10200