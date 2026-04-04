// Transport layer implementations.
// Provides TCP (reliable), UDP (fast), and in-memory (test) delivery strategies.

#include "transport.h"
#include <thread>
#include <cmath>
#include <iostream>

// --- TcpTransport ---

TcpTransport::TcpTransport(int port, const RetryPolicy& policy)
    : port_(port),
      retryPolicy_(policy),
      state_(ConnectionState::DISCONNECTED),
      keepAlive_(false),
      keepAliveInterval_(30) {
}

TcpTransport::~TcpTransport() {
  disconnect();
}

DeliveryResult TcpTransport::send(const Message& message, const std::string& destination) {
  if (state_ != ConnectionState::CONNECTED) {
    if (!reconnect()) {
      return DeliveryResult{false, "Not connected and reconnect failed", 0, destination};
    }
  }

  // Validate message before sending
  if (!message.validate()) {
    return DeliveryResult{false, "Message validation failed", 0, destination};
  }

  // Check payload size limit
  if (message.payloadSize() > getMaxPayloadSize()) {
    return DeliveryResult{false, "Payload exceeds maximum size", 0, destination};
  }

  std::string payload = message.serialize();
  return sendWithRetry(payload, destination);
}

bool TcpTransport::connect(const std::string& endpoint) {
  if (state_ == ConnectionState::CONNECTED) {
    if (currentEndpoint_ == endpoint) {
      return true;  // Already connected to this endpoint
    }
    disconnect();  // Disconnect from current before connecting to new
  }

  state_ = ConnectionState::CONNECTING;
  currentEndpoint_ = endpoint;

  // Simulate connection (in real impl, would open socket)
  // Validate endpoint format: host:port
  size_t colonPos = endpoint.find(':');
  if (colonPos == std::string::npos || colonPos == 0 || colonPos == endpoint.length() - 1) {
    state_ = ConnectionState::FAILED;
    return false;
  }

  state_ = ConnectionState::CONNECTED;
  return true;
}

void TcpTransport::disconnect() {
  if (state_ == ConnectionState::DISCONNECTED) {
    return;
  }
  state_ = ConnectionState::DISCONNECTED;
  currentEndpoint_.clear();
}

ConnectionState TcpTransport::getState() const {
  return state_;
}

std::string TcpTransport::getName() const {
  return "TCP";
}

size_t TcpTransport::getMaxPayloadSize() const {
  return 16 * 1024 * 1024;  // 16 MB
}

void TcpTransport::setKeepAlive(bool enabled, int intervalSec) {
  keepAlive_ = enabled;
  keepAliveInterval_ = intervalSec;
}

DeliveryResult TcpTransport::sendWithRetry(const std::string& payload,
                                            const std::string& destination) {
  int attempts = 0;
  int delayMs = retryPolicy_.baseDelayMs;

  while (attempts <= retryPolicy_.maxRetries) {
    auto start = std::chrono::steady_clock::now();

    // Simulate send attempt — in real code this would write to socket
    bool success = (state_ == ConnectionState::CONNECTED);

    auto end = std::chrono::steady_clock::now();
    int64_t latency = std::chrono::duration_cast<std::chrono::milliseconds>(end - start).count();

    if (success) {
      return DeliveryResult{true, "", latency, destination};
    }

    attempts++;
    if (attempts > retryPolicy_.maxRetries) {
      break;
    }

    // Exponential backoff
    std::this_thread::sleep_for(std::chrono::milliseconds(delayMs));
    delayMs = static_cast<int>(delayMs * retryPolicy_.backoffMultiplier);

    // Try reconnecting
    if (retryPolicy_.retryOnTimeout) {
      reconnect();
    }
  }

  return DeliveryResult{false, "Max retries exceeded", 0, destination};
}

bool TcpTransport::reconnect() {
  if (currentEndpoint_.empty()) {
    return false;
  }

  state_ = ConnectionState::RECONNECTING;

  // Simulate reconnection attempt
  size_t colonPos = currentEndpoint_.find(':');
  if (colonPos == std::string::npos) {
    state_ = ConnectionState::FAILED;
    return false;
  }

  state_ = ConnectionState::CONNECTED;
  return true;
}

// --- UdpTransport ---

UdpTransport::UdpTransport(int port)
    : port_(port),
      state_(ConnectionState::DISCONNECTED),
      fragmentationEnabled_(false),
      maxFragmentSize_(1400) {
}

UdpTransport::~UdpTransport() {
  disconnect();
}

DeliveryResult UdpTransport::send(const Message& message, const std::string& destination) {
  if (state_ != ConnectionState::CONNECTED) {
    return DeliveryResult{false, "Not connected", 0, destination};
  }

  std::string payload = message.serialize();

  // Handle large payloads via fragmentation
  if (payload.size() > maxFragmentSize_) {
    if (!fragmentationEnabled_) {
      return DeliveryResult{false, "Payload too large and fragmentation disabled", 0, destination};
    }

    auto fragments = fragmentPayload(payload);
    auto start = std::chrono::steady_clock::now();

    for (const auto& fragment : fragments) {
      // Simulate sending each fragment
      if (fragment.empty()) {
        return DeliveryResult{false, "Empty fragment generated", 0, destination};
      }
    }

    auto end = std::chrono::steady_clock::now();
    int64_t latency = std::chrono::duration_cast<std::chrono::milliseconds>(end - start).count();
    return DeliveryResult{true, "", latency, destination};
  }

  // Direct send for small payloads
  auto start = std::chrono::steady_clock::now();
  auto end = std::chrono::steady_clock::now();
  int64_t latency = std::chrono::duration_cast<std::chrono::milliseconds>(end - start).count();

  return DeliveryResult{true, "", latency, destination};
}

bool UdpTransport::connect(const std::string& endpoint) {
  state_ = ConnectionState::CONNECTED;
  return true;
}

void UdpTransport::disconnect() {
  state_ = ConnectionState::DISCONNECTED;
}

ConnectionState UdpTransport::getState() const {
  return state_;
}

std::string UdpTransport::getName() const {
  return "UDP";
}

size_t UdpTransport::getMaxPayloadSize() const {
  if (fragmentationEnabled_) {
    return 64 * 1024 * 1024;  // 64 MB with fragmentation
  }
  return maxFragmentSize_;
}

void UdpTransport::setFragmentation(bool enabled, size_t maxFragmentSize) {
  fragmentationEnabled_ = enabled;
  maxFragmentSize_ = maxFragmentSize;
}

std::vector<std::string> UdpTransport::fragmentPayload(const std::string& payload) {
  std::vector<std::string> fragments;
  size_t offset = 0;

  while (offset < payload.size()) {
    size_t chunkSize = std::min(maxFragmentSize_, payload.size() - offset);
    fragments.push_back(payload.substr(offset, chunkSize));
    offset += chunkSize;
  }

  return fragments;
}

// --- InMemoryTransport ---

InMemoryTransport::InMemoryTransport()
    : state_(ConnectionState::DISCONNECTED) {
}

DeliveryResult InMemoryTransport::send(const Message& message, const std::string& destination) {
  if (state_ != ConnectionState::CONNECTED) {
    return DeliveryResult{false, "Not connected", 0, destination};
  }

  if (!message.validate()) {
    return DeliveryResult{false, "Invalid message", 0, destination};
  }

  std::string payload = message.serialize();

  {
    std::lock_guard<std::mutex> lock(mutex_);
    deliveredPayloads_.push_back(payload);
  }

  return DeliveryResult{true, "", 0, destination};
}

bool InMemoryTransport::connect(const std::string& endpoint) {
  state_ = ConnectionState::CONNECTED;
  return true;
}

void InMemoryTransport::disconnect() {
  state_ = ConnectionState::DISCONNECTED;
}

ConnectionState InMemoryTransport::getState() const {
  return state_;
}

std::string InMemoryTransport::getName() const {
  return "InMemory";
}

size_t InMemoryTransport::getMaxPayloadSize() const {
  return 100 * 1024 * 1024;  // 100 MB — no real limit in memory
}

size_t InMemoryTransport::getDeliveredCount() const {
  std::lock_guard<std::mutex> lock(mutex_);
  return deliveredPayloads_.size();
}

void InMemoryTransport::clearDelivered() {
  std::lock_guard<std::mutex> lock(mutex_);
  deliveredPayloads_.clear();
}

std::vector<std::string> InMemoryTransport::getDeliveredPayloads() const {
  std::lock_guard<std::mutex> lock(mutex_);
  return deliveredPayloads_;
}
