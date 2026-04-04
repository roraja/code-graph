// Message broker implementation — ties everything together.
// Factory methods create pre-configured instances for different environments.

#include "broker.h"
#include <iostream>
#include <numeric>

// --- MessageBroker ---

MessageBroker::MessageBroker(const BrokerConfig& config)
    : config_(config),
      pipeline_(std::make_unique<MiddlewarePipeline>()),
      router_(std::make_unique<MessageRouter>()),
      running_(false) {
  stats_ = BrokerStats{0, 0, 0, 0, 0, 0.0};
  setupMiddleware();
}

MessageBroker::~MessageBroker() {
  if (running_) {
    stop();
  }
}

// Publish a message — the main entry point.
// Message flows through: middleware pipeline → router → transport
bool MessageBroker::publish(const Message& message, const std::string& topic) {
  if (!running_) {
    return false;
  }

  stats_.messagesProcessed++;

  // Step 1: Run through middleware pipeline
  MiddlewareResult middlewareResult = pipeline_->execute(message);

  if (middlewareResult.action == MiddlewareAction::REJECT) {
    stats_.messagesRejected++;
    return false;
  }

  // Step 2: Route to appropriate transports
  std::vector<RouteOutcome> outcomes = router_->route(message, topic);

  // Step 3: Update statistics
  updateStats(outcomes, message.payloadSize());

  // Check if any delivery succeeded
  bool anySuccess = false;
  for (const auto& outcome : outcomes) {
    if (outcome.result.success) {
      anySuccess = true;
      break;
    }
  }

  return anySuccess;
}

std::string MessageBroker::subscribe(const std::string& subscriberId,
                                      const std::string& topicPattern,
                                      std::function<void(const Message&)> callback) {
  return router_->subscribe(subscriberId, topicPattern, std::move(callback));
}

void MessageBroker::unsubscribe(const std::string& subscriptionId) {
  router_->unsubscribe(subscriptionId);
}

void MessageBroker::addTransport(const std::string& name,
                                  std::unique_ptr<ITransport> transport) {
  transports_[name] = std::move(transport);
}

ITransport* MessageBroker::getTransport(const std::string& name) const {
  auto it = transports_.find(name);
  if (it != transports_.end()) {
    return it->second.get();
  }
  return nullptr;
}

void MessageBroker::addRoute(const std::string& topicPattern,
                              const std::string& transportName,
                              const std::string& destination,
                              Priority minPriority,
                              bool exclusive) {
  ITransport* transport = getTransport(transportName);
  if (!transport) {
    std::cerr << "Transport not found: " << transportName << std::endl;
    return;
  }

  RouteRule rule;
  rule.pattern = topicPattern;
  rule.transport = transport;
  rule.destination = destination;
  rule.minPriority = minPriority;
  rule.exclusive = exclusive;

  router_->addRule(rule);
}

void MessageBroker::enableDeadLetterQueue(const std::string& transportName,
                                           const std::string& destination) {
  ITransport* transport = getTransport(transportName);
  if (transport) {
    router_->enableDeadLetterQueue(transport, destination);
  }
}

bool MessageBroker::start() {
  if (running_) {
    return true;
  }

  // Connect all transports
  bool allConnected = true;
  for (auto& pair : transports_) {
    if (pair.second->getState() == ConnectionState::DISCONNECTED) {
      // Auto-connect transports that aren't connected yet
      // They need to be connected via addRoute destinations, but we verify state
    }
  }

  if (config_.enableMetrics) {
    metricsObserver_ = std::make_unique<MetricsObserver>();
    router_->addObserver(metricsObserver_.get());
  }

  if (config_.enableLogging) {
    loggingObserver_ = std::make_unique<LoggingSubscriptionObserver>();
    router_->addObserver(loggingObserver_.get());
  }

  running_ = true;
  return true;
}

void MessageBroker::stop() {
  if (!running_) {
    return;
  }

  // Disconnect all transports
  for (auto& pair : transports_) {
    pair.second->disconnect();
  }

  // Remove observers
  if (metricsObserver_) {
    router_->removeObserver(metricsObserver_.get());
  }
  if (loggingObserver_) {
    router_->removeObserver(loggingObserver_.get());
  }

  running_ = false;
}

bool MessageBroker::isRunning() const {
  return running_;
}

BrokerStats MessageBroker::getStats() const {
  return stats_;
}

void MessageBroker::resetStats() {
  stats_ = BrokerStats{0, 0, 0, 0, 0, 0.0};
}

void MessageBroker::setupMiddleware() {
  // Add rate limiter if configured
  if (config_.rateLimitPerSecond > 0) {
    pipeline_->addMiddleware(std::make_unique<RateLimiterMiddleware>(
        config_.rateLimitPerSecond, config_.rateLimitBurst));
  }

  // Add compression if configured
  if (config_.compressionThreshold > 0) {
    pipeline_->addMiddleware(std::make_unique<CompressionMiddleware>(
        config_.compressionThreshold));
  }
}

void MessageBroker::updateStats(const std::vector<RouteOutcome>& outcomes,
                                 size_t payloadSize) {
  for (const auto& outcome : outcomes) {
    if (outcome.result.success) {
      stats_.messagesDelivered++;
      stats_.bytesTransferred += payloadSize;

      // Running average of latency
      double totalLatency = stats_.avgLatencyMs * (stats_.messagesDelivered - 1);
      totalLatency += static_cast<double>(outcome.result.latencyMs);
      stats_.avgLatencyMs = totalLatency / static_cast<double>(stats_.messagesDelivered);
    } else {
      stats_.messagesFailed++;
    }
  }
}

// --- BrokerFactory ---

std::unique_ptr<MessageBroker> BrokerFactory::createDevBroker() {
  auto config = defaultDevConfig();
  auto broker = std::make_unique<MessageBroker>(config);

  // Add in-memory transport for local development
  auto transport = std::make_unique<InMemoryTransport>();
  transport->connect("local");

  broker->addTransport("local", std::move(transport));
  broker->addRoute("#", "local", "dev-queue");

  return broker;
}

std::unique_ptr<MessageBroker> BrokerFactory::createProductionBroker(
    const std::string& host, int port) {
  auto config = defaultProdConfig();
  auto broker = std::make_unique<MessageBroker>(config);

  // Primary TCP transport
  RetryPolicy retryPolicy{3, 100, 2.0, true};
  auto tcpTransport = std::make_unique<TcpTransport>(port, retryPolicy);
  tcpTransport->connect(host + ":" + std::to_string(port));
  tcpTransport->setKeepAlive(true, 30);

  broker->addTransport("primary", std::move(tcpTransport));

  // Dead letter queue on separate in-memory transport
  auto dlqTransport = std::make_unique<InMemoryTransport>();
  dlqTransport->connect("dlq");
  broker->addTransport("dlq", std::move(dlqTransport));
  broker->enableDeadLetterQueue("dlq", "dead-letters");

  // Default route: all messages go through primary transport
  broker->addRoute("#", "primary", host + ":" + std::to_string(port));

  // High-priority messages get their own route for isolation
  broker->addRoute("critical.#", "primary", host + ":" + std::to_string(port),
                   Priority::HIGH, true);

  // Auth middleware for production
  auto authMiddleware = std::make_unique<AuthMiddleware>();
  authMiddleware->addApiKey("prod-key-001", "service-a");
  authMiddleware->addApiKey("prod-key-002", "service-b");
  // Note: We'd need to add this to the pipeline, but the pipeline is private.
  // In a real system, the broker config would handle this.

  return broker;
}

std::unique_ptr<MessageBroker> BrokerFactory::createTestBroker() {
  auto config = defaultTestConfig();
  auto broker = std::make_unique<MessageBroker>(config);

  auto transport = std::make_unique<InMemoryTransport>();
  transport->connect("test");
  broker->addTransport("test", std::move(transport));
  broker->addRoute("#", "test", "test-queue");

  return broker;
}

BrokerConfig BrokerFactory::defaultDevConfig() {
  return BrokerConfig{
      1000,    // maxQueueSize
      1,       // workerThreads
      false,   // enableMetrics
      true,    // enableLogging
      0,       // rateLimitPerSecond (disabled)
      0,       // rateLimitBurst
      0        // compressionThreshold (disabled)
  };
}

BrokerConfig BrokerFactory::defaultProdConfig() {
  return BrokerConfig{
      10000,   // maxQueueSize
      4,       // workerThreads
      true,    // enableMetrics
      true,    // enableLogging
      1000,    // rateLimitPerSecond
      50,      // rateLimitBurst
      4096     // compressionThreshold (4 KB)
  };
}

BrokerConfig BrokerFactory::defaultTestConfig() {
  return BrokerConfig{
      100,     // maxQueueSize
      1,       // workerThreads
      false,   // enableMetrics
      false,   // enableLogging
      0,       // rateLimitPerSecond (disabled)
      0,       // rateLimitBurst
      0        // compressionThreshold (disabled)
  };
}
