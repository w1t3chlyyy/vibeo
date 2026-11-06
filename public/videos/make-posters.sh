#!/bin/sh
# Запуск из папки public/videos:   sh make-posters.sh
# Делает постеры 1.jpg … 7.jpg (первый кадр) из роликов 1.mp4 … 7.mp4. Нужен ffmpeg.
for f in [0-9]*.mp4; do
  n="${f%.mp4}"
  ffmpeg -y -loglevel error -i "$f" -frames:v 1 -vf scale=640:-2 -q:v 5 "$n.jpg"
done
