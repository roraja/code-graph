// Transport layer abstraction using the Strategy pattern.
// Defines how messages are delivered across different mediums.

#ifndef TRANSPORT_H
#define TRANSPORT_H

#include "message.h"
#include <functional>
#include <queue>
#include <mutex>

// Delivery result returned by transport operations
struct DeliveryResult {
  bool success;
  std::string error;
  int64_t latencyMs;
  std::string destination;
};

// Retry policy for failed deliveries
struct RetryPolicy {
  int maxRetries;
  int baseDelayMs;
  double backoffMultiplier;
  bool retryOnTimeout;
};

// Connection state for stateful transports
enum class ConnectionState {
  DISCONNECTED,
  CONNECTING,
  CONNECTED,
  RECONNECTING,
  FAILED
};

// Abstract transport interface — Strategy pattern
class ITransport {
public:
  virtual ~ITransport() = default;

  virtual DeliveryResult send(const Message& message, const std::string& destination) = 0;
  virtual bool connect(const std::string& endpoint) = 0;
  virtual void disconnect() = 0;
  virtual ConnectionState getState() const = 0;
  virtual std::string getName() const = 0;
  virtual size_t getMaxPayloadSize() const = 0;
};

// TCP transport — reliable ordered delivery
class TcpTransport : public ITransport {
public:
  TcpTransport(int port, const RetryPolicy& policy);
  ~TcpTransport();

  DeliveryResult send(const Message& message, const std::string& destination) override;
  bool connect(const std::string& endpoint) override;
  void disconnect() override;
  ConnectionState getState() const override;
  std::string getName() const override;
  size_t getMaxPayloadSize() const override;

  void setKeepAlive(bool enabled, int intervalSec);

private:
  int port_;
  RetryPolicy retryPolicy_;
  ConnectionState state_;
  bool keepAlive_;
  int keepAliveInterval_;
  std::string currentEndpoint_;

  DeliveryResult sendWithRetry(const std::string& payload, const std::string& destination);
  bool reconnect();
};

// UDP transport — fast unreliable delivery
class UdpTransport : public ITransport {
public:
  UdpTransport(int port);
  ~UdpTransport();

  DeliveryResult send(const Message& message, const std::string& destination) override;
  bool connect(const std::string& endpoint) override;
  void disconnect() override;
  ConnectionState getState() const override;
  std::string getName() const override;
  size_t getMaxPayloadSize() const override;

  void setFragmentation(bool enabled, size_t maxFragmentSize);

private:
  int port_;
  ConnectionState state_;
  bool fragmentationEnabled_;
  size_t maxFragmentSize_;

  std::vector<std::string> fragmentPayload(const std::string& payload);
};

// In-memory transport for testing and local IPC
class InMemoryTransport : public ITransport {
public:
  InMemoryTransport();

  DeliveryResult send(const Message& message, const std::string& destination) override;
  bool connect(const std::string& endpoint) override;
  void disconnect() override;
  ConnectionState getState() const override;
  std::string getName() const override;
  size_t getMaxPayloadSize() const override;

  // Test helpers
  size_t getDeliveredCount() const;
  void clearDelivered();
  std::vector<std::string> getDeliveredPayloads() const;

private:
  ConnectionState state_;
  std::vector<std::string> deliveredPayloads_;
  mutable std::mutex mutex_;
};

#endif // TRANSPORT_H
