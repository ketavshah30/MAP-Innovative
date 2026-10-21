#!/bin/sh
set -eu
for topic in catalog.title.v1 profile.lifecycle.v1 playback.session.lifecycle.v1 playback.session.ended.v1 watch.history.recorded.v1 billing.subscription.v1 billing.payment.v1 trending.snapshot.v1; do
  /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --create --if-not-exists --topic "$topic" --partitions 3 --replication-factor 1
done
