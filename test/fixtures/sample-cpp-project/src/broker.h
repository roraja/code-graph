// Message broker — the top-level orchestrator that ties together
// the middleware pipeline, router, and transport layer.
// Factory pattern for creating pre-configured broker instances.

#ifndef BROKER_H
#define BROKER_H

#include "message.h"
#include "transport.h"
#include "router.h"
#include "middleware.h"
#include <memory>

// Broker statistics for monitoring
struct BrokerStats {
  size_t messagesProcessed;
  size_t messagesDelivered;
  size_t messagesFailed;
  size_t messagesRejected;
  size_t bytesTransferred;
  double avgLatencyMs;
};

// Broker configuration
struct BrokerConfig {
  int maxQueueSize;
  int workerThreads;
  bool enableMetrics;
  bool enableLogging;
  int rateLimitPerSecond;
  int rateLimitBurst;
  size_t compressionThreshold;
};

// Message broker — main entry point for the messaging system
class MessageBroker {
public:
  MessageBroker(const BrokerConfig& config);
  ~MessageBroker();

  // Publish a message to a topic
  bool publish(const Message& message, const std::string& topic);

  // Subscribe to a topic pattern
  std::string subscribe(const std::string& subscriberId,
                         const std::string& topicPattern,
                         std::function<void(const Message&)> callback);

  // Unsubscribe
  void unsubscribe(const std::string& subscriptionId);

  // Transport management
  void addTransport(const std::string& name, std::unique_ptr<ITransport> transport);
  ITransport* getTransport(const std::string& name) const;

  // Route configuration
  void addRoute(const std::string& topicPattern,
                const std::string& transportName,
                const std::string& destination,
                Priority minPriority = Priority::LOW,
                bool exclusive = false);

  // Dead letter queue
  void enableDeadLetterQueue(const std::string& transportName,
                              const std::string& destination);

  // Lifecycle
  bool start();
  void stop();
  bool isRunning() const;

  // Stats
  BrokerStats getStats() const;
  void resetStats();

private:
  BrokerConfig config_;
  std::unique_ptr<MiddlewarePipeline> pipeline_;
  std::unique_ptr<MessageRouter> router_;
  std::map<std::string, std::unique_ptr<ITransport>> transports_;

  BrokerStats stats_;
  bool running_;

  std::unique_ptr<LoggingSubscriptionObserver> loggingObserver_;
  std::unique_ptr<MetricsObserver> metricsObserver_;

  void setupMiddleware();
  void updateStats(const std::vector<RouteOutcome>& outcomes, size_t payloadSize);
};

// Factory for creating pre-configured brokers
class BrokerFactory {
public:
  // Create a development broker (in-memory transport, verbose logging)
  static std::unique_ptr<MessageBroker> createDevBroker();

  // Create a production broker (TCP transport, metrics, rate limiting)
  static std::unique_ptr<MessageBroker> createProductionBroker(
      const std::string& host, int port);

  // Create a test broker (in-memory, no middleware)
  static std::unique_ptr<MessageBroker> createTestBroker();

private:
  static BrokerConfig defaultDevConfig();
  static BrokerConfig defaultProdConfig();
  static BrokerConfig defaultTestConfig();
};

#endif // BROKER_H
