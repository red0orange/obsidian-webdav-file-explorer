DIR=$(pwd)/../
xhost + && docker run --gpus all --env NVIDIA_DISABLE_REQUIRE=1 -it --network=host --name obsidian_plugin --cap-add=SYS_PTRACE --security-opt seccomp=unconfined \
  -v $DIR:$DIR \
  -v /home:/home \
  -v /dev:/dev \
  -v /mnt:/mnt \
  -v /tmp/.X11-unix:/tmp/.X11-unix \
  -v /tmp:/tmp \
  --ipc=host \
  --privileged \
  -e DISPLAY=${DISPLAY} \
  -e GIT_INDEX_FILE \
  my_image:cuda121 bash -c "cd $DIR && bash"
