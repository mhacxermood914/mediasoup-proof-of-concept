# mediasoup-proof-of-concept

Here's the `README.md` file including all the steps you've mentioned:

```markdown
# Docker Compose Setup for Example1

## Prerequisites

- Ensure Docker and Docker Compose are installed on your machine.

## Steps to Build and Run the Application

### 1. Build the Docker Images

To build the Docker images, run the following command:

```sh
docker-compose build
```

### 2. Start the Docker Containers

To start the Docker containers in detached mode, run the following command twice to ensure the container is not just created but also running properly:

```sh
docker-compose up -d
docker-compose up -d
```

### 3. Access the Running Container

To access the running container, execute the following command (replace `<container_id>` with your container's actual ID):

```sh
docker exec -it <container_id> /bin/bash
```

### 4. Navigate to the Application Directory

Once inside the container, navigate to the application directory:

```sh
cd /usr/src/example1
```

### 5. Start the Web Server

To start the web server, run the following command:

```sh
npm start
```

### 6. Watch for Changes

If you make modifications to the `public/index.js` file, you need to run the following command to watch for changes and recompile the code:

```sh
npm run watch
```

## Notes

- Ensure you have the necessary permissions to run Docker commands.
- If you encounter any issues, check the container logs using `docker-compose logs`.
- The `npm start` command launches the web server.
- The `npm run watch` command is required when the `public/index.js` file is modified.
```

This `README.md` file includes all the necessary steps to build, run, and manage your Dockerized application, along with additional context and notes.