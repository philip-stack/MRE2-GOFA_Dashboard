// Copyright 2020 ROS2-Control Development Team
// Modifications Copyright 2022 PickNik Inc
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

#include <abb_hardware_interface/abb_hardware_interface.hpp>
#include <abb_hardware_interface/utilities.hpp>

#include <limits>
#include <sstream>

using namespace std::chrono_literals;

namespace abb_hardware_interface
{
static constexpr size_t NUM_CONNECTION_TRIES = 100;
static constexpr double DEG_TO_RAD = M_PI / 180.0;
static constexpr double MM_TO_M = 0.001;
static const rclcpp::Logger LOGGER = rclcpp::get_logger("ABBSystemHardware");

namespace
{
uint8_t mapEgmState(abb::egm::wrapper::Status_EGMState state)
{
  switch (state)
  {
    case abb::egm::wrapper::Status_EGMState_EGM_ERROR:
      return abb_egm_msgs::msg::EGMChannelState::EGM_ERROR;
    case abb::egm::wrapper::Status_EGMState_EGM_STOPPED:
      return abb_egm_msgs::msg::EGMChannelState::EGM_STOPPED;
    case abb::egm::wrapper::Status_EGMState_EGM_RUNNING:
      return abb_egm_msgs::msg::EGMChannelState::EGM_RUNNING;
    case abb::egm::wrapper::Status_EGMState_EGM_UNDEFINED:
    default:
      return abb_egm_msgs::msg::EGMChannelState::EGM_UNDEFINED;
  }
}

uint8_t mapMotorState(abb::egm::wrapper::Status_MotorState state)
{
  switch (state)
  {
    case abb::egm::wrapper::Status_MotorState_MOTORS_ON:
      return abb_egm_msgs::msg::EGMChannelState::MOTORS_ON;
    case abb::egm::wrapper::Status_MotorState_MOTORS_OFF:
      return abb_egm_msgs::msg::EGMChannelState::MOTORS_OFF;
    case abb::egm::wrapper::Status_MotorState_MOTORS_UNDEFINED:
    default:
      return abb_egm_msgs::msg::EGMChannelState::MOTORS_UNDEFINED;
  }
}

uint8_t mapRapidState(abb::egm::wrapper::Status_RAPIDExecutionState state)
{
  switch (state)
  {
    case abb::egm::wrapper::Status_RAPIDExecutionState_RAPID_STOPPED:
      return abb_egm_msgs::msg::EGMChannelState::RAPID_STOPPED;
    case abb::egm::wrapper::Status_RAPIDExecutionState_RAPID_RUNNING:
      return abb_egm_msgs::msg::EGMChannelState::RAPID_RUNNING;
    case abb::egm::wrapper::Status_RAPIDExecutionState_RAPID_UNDEFINED:
    default:
      return abb_egm_msgs::msg::EGMChannelState::RAPID_UNDEFINED;
  }
}

void appendJointNames(const abb::robot::MotionData::MechanicalUnitGroup& group, const bool robot,
                      std::vector<std::string>& names)
{
  for (const auto& unit : group.units)
  {
    const bool is_robot = unit.active && unit.type == abb::robot::MechanicalUnit_Type_TCP_ROBOT;
    const bool is_external = unit.active && (unit.type == abb::robot::MechanicalUnit_Type_ROBOT ||
                                             unit.type == abb::robot::MechanicalUnit_Type_SINGLE);
    if ((robot && is_robot) || (!robot && is_external))
    {
      for (const auto& joint : unit.joints)
      {
        names.push_back(joint.name);
      }
    }
  }
}

void appendJointValues(const abb::egm::wrapper::JointSpace& joints, const bool include_velocity,
                       sensor_msgs::msg::JointState& message)
{
  const int position_size = joints.has_position() ? joints.position().values_size() : 0;
  const int velocity_size = joints.has_velocity() ? joints.velocity().values_size() : 0;
  for (int i = 0; i < position_size; ++i)
  {
    message.position.push_back(joints.position().values(i) * DEG_TO_RAD);
  }
  if (include_velocity && velocity_size == position_size)
  {
    for (int i = 0; i < velocity_size; ++i)
    {
      message.velocity.push_back(joints.velocity().values(i) * DEG_TO_RAD);
    }
  }
}

template <typename SourceT>
void appendSourceJointTelemetry(const SourceT& source, const abb::robot::MotionData::MechanicalUnitGroup& group,
                                sensor_msgs::msg::JointState& message, bool& velocity_complete)
{
  if (source.has_robot() && source.robot().has_joints() && source.robot().joints().has_position())
  {
    appendJointNames(group, true, message.name);
    const auto before_velocities = message.velocity.size();
    appendJointValues(source.robot().joints(), true, message);
    velocity_complete = velocity_complete &&
                        (message.velocity.size() - before_velocities ==
                         static_cast<size_t>(source.robot().joints().position().values_size()));
  }
  if (source.has_external() && source.external().has_joints() && source.external().joints().has_position())
  {
    appendJointNames(group, false, message.name);
    const auto before_velocities = message.velocity.size();
    appendJointValues(source.external().joints(), true, message);
    velocity_complete = velocity_complete &&
                        (message.velocity.size() - before_velocities ==
                         static_cast<size_t>(source.external().joints().position().values_size()));
  }
}

void appendJsonArray(std::ostringstream& stream, const abb::egm::wrapper::Joints& values, const double scale)
{
  stream << "[";
  for (int i = 0; i < values.values_size(); ++i)
  {
    if (i > 0)
    {
      stream << ",";
    }
    stream << values.values(i) * scale;
  }
  stream << "]";
}

void appendJointSpaceJson(std::ostringstream& stream, const abb::egm::wrapper::JointSpace& joints)
{
  stream << "{";
  stream << "\"position_rad\":";
  if (joints.has_position())
  {
    appendJsonArray(stream, joints.position(), DEG_TO_RAD);
  }
  else
  {
    stream << "[]";
  }
  stream << ",\"velocity_rad_s\":";
  if (joints.has_velocity())
  {
    appendJsonArray(stream, joints.velocity(), DEG_TO_RAD);
  }
  else
  {
    stream << "[]";
  }
  stream << "}";
}

void appendCartesianJson(std::ostringstream& stream, const abb::egm::wrapper::CartesianSpace& cartesian)
{
  stream << "{";
  if (cartesian.has_pose() && cartesian.pose().has_position())
  {
    const auto& position = cartesian.pose().position();
    stream << "\"position_m\":{\"x\":" << position.x() * MM_TO_M << ",\"y\":" << position.y() * MM_TO_M
           << ",\"z\":" << position.z() * MM_TO_M << "}";
  }
  else
  {
    stream << "\"position_m\":null";
  }
  if (cartesian.has_pose() && cartesian.pose().has_quaternion())
  {
    const auto& q = cartesian.pose().quaternion();
    stream << ",\"quaternion\":{\"x\":" << q.u1() << ",\"y\":" << q.u2() << ",\"z\":" << q.u3()
           << ",\"w\":" << q.u0() << "}";
  }
  else
  {
    stream << ",\"quaternion\":null";
  }
  if (cartesian.has_pose() && cartesian.pose().has_euler())
  {
    const auto& e = cartesian.pose().euler();
    stream << ",\"euler_deg\":{\"x\":" << e.x() << ",\"y\":" << e.y() << ",\"z\":" << e.z() << "}";
  }
  else
  {
    stream << ",\"euler_deg\":null";
  }
  stream << "}";
}

void appendRobotJson(std::ostringstream& stream, const abb::egm::wrapper::Robot& robot)
{
  stream << "{";
  stream << "\"joints\":";
  if (robot.has_joints())
  {
    appendJointSpaceJson(stream, robot.joints());
  }
  else
  {
    stream << "null";
  }
  stream << ",\"cartesian\":";
  if (robot.has_cartesian())
  {
    appendCartesianJson(stream, robot.cartesian());
  }
  else
  {
    stream << "null";
  }
  stream << "}";
}

template <typename SourceT>
bool fillPoseMessage(const SourceT& source, const std::string& frame_id, const rclcpp::Time& time,
                     geometry_msgs::msg::PoseStamped& message)
{
  if (!source.has_robot() || !source.robot().has_cartesian() || !source.robot().cartesian().has_pose())
  {
    return false;
  }
  const auto& pose = source.robot().cartesian().pose();
  if (!pose.has_position() || !pose.has_quaternion())
  {
    return false;
  }

  message.header.stamp = time;
  message.header.frame_id = frame_id;
  message.pose.position.x = pose.position().x() * MM_TO_M;
  message.pose.position.y = pose.position().y() * MM_TO_M;
  message.pose.position.z = pose.position().z() * MM_TO_M;
  message.pose.orientation.x = pose.quaternion().u1();
  message.pose.orientation.y = pose.quaternion().u2();
  message.pose.orientation.z = pose.quaternion().u3();
  message.pose.orientation.w = pose.quaternion().u0();
  return true;
}
}  // namespace

CallbackReturn ABBSystemHardware::on_init(const hardware_interface::HardwareInfo& info)
{
  if (hardware_interface::SystemInterface::on_init(info) != CallbackReturn::SUCCESS)
  {
    return CallbackReturn::ERROR;
  }

  // Validate interfaces configured in ros2_control xacro.
  for (const hardware_interface::ComponentInfo& joint : info_.joints)
  {
    if (joint.command_interfaces.size() != 2)
    {
      RCLCPP_FATAL(LOGGER, "Joint '%s' has %zu command interfaces found. 2 expected.", joint.name.c_str(),
                   joint.command_interfaces.size());
      return CallbackReturn::ERROR;
    }

    if (joint.command_interfaces[0].name != hardware_interface::HW_IF_POSITION)
    {
      RCLCPP_FATAL(LOGGER, "Joint '%s' have %s command interfaces found as first command interface. '%s' expected.",
                   joint.name.c_str(), joint.command_interfaces[0].name.c_str(), hardware_interface::HW_IF_POSITION);
      return CallbackReturn::ERROR;
    }

    if (joint.command_interfaces[1].name != hardware_interface::HW_IF_VELOCITY)
    {
      RCLCPP_FATAL(LOGGER, "Joint '%s' have %s command interfaces found as second command interface. '%s' expected.",
                   joint.name.c_str(), joint.command_interfaces[1].name.c_str(), hardware_interface::HW_IF_VELOCITY);
      return CallbackReturn::ERROR;
    }

    if (joint.state_interfaces.size() != 2)
    {
      RCLCPP_FATAL(LOGGER, "Joint '%s' has %zu state interface. 2 expected.", joint.name.c_str(),
                   joint.state_interfaces.size());
      return CallbackReturn::ERROR;
    }

    if (joint.state_interfaces[0].name != hardware_interface::HW_IF_POSITION)
    {
      RCLCPP_FATAL(LOGGER, "Joint '%s' have %s state interface as first state interface. '%s' expected.",
                   joint.name.c_str(), joint.state_interfaces[0].name.c_str(), hardware_interface::HW_IF_POSITION);
      return CallbackReturn::ERROR;
    }

    if (joint.state_interfaces[1].name != hardware_interface::HW_IF_VELOCITY)
    {
      RCLCPP_FATAL(LOGGER, "Joint '%s' have %s state interface as first state interface. '%s' expected.",
                   joint.name.c_str(), joint.state_interfaces[1].name.c_str(), hardware_interface::HW_IF_VELOCITY);
      return CallbackReturn::ERROR;
    }
  }

  // By default, construct the robot_controller_description_ by connecting to RWS.
  // If configure_via_rws is set to false, configure the robot_controller_description_
  // relying on joint information in the ros2_control xacro.
  const auto configure_it = info_.hardware_parameters.find("configure_via_rws");
  const bool configure_via_rws = configure_it == info_.hardware_parameters.end()                    ? true :
                                 configure_it->second == "false" || configure_it->second == "False" ? false :
                                                                                                      true;

  if (configure_via_rws)
  {
    RCLCPP_INFO_STREAM(LOGGER, "Generating robot controller description from RWS.");
    const auto rws_port = stoi(info_.hardware_parameters["rws_port"]);
    const auto rws_ip = info_.hardware_parameters["rws_ip"];

    if (rws_ip == "None")
    {
      RCLCPP_FATAL(LOGGER, "RWS IP not specified");
      return CallbackReturn::ERROR;
    }

    // Get robot controller description from RWS
    abb::robot::RWSManager rws_manager(rws_ip, rws_port, "Default User", "robotics");
    robot_controller_description_ = abb::robot::utilities::establishRWSConnection(rws_manager, "IRB1200", true);
  }
  else
  {
    RCLCPP_INFO_STREAM(LOGGER, "Generating robot controller description from HardwareInfo.");

    // Add header.
    auto header{ robot_controller_description_.mutable_header() };
    // Omnicore controllers have RobotWare version >=7.0.0.
    header->mutable_robot_ware_version()->set_major_number(7);
    header->mutable_robot_ware_version()->set_minor_number(3);
    header->mutable_robot_ware_version()->set_patch_number(2);

    // Add system indicators.
    auto system_indicators{ robot_controller_description_.mutable_system_indicators() };
    system_indicators->mutable_options()->set_egm(true);

    // Add single mechanical units group.
    auto mug{ robot_controller_description_.add_mechanical_units_groups() };
    mug->set_name("");

    // Add single robot to mechanical units group.
    auto robot{ mug->mutable_robot() };
    robot->set_type(abb::robot::MechanicalUnit_Type_TCP_ROBOT);
    robot->set_axes_total(info_.joints.size());
    robot->set_mode(abb::robot::MechanicalUnit_Mode_ACTIVATED);

    // Add joints to robot.
    for (std::size_t i = 0; i < info_.joints.size(); ++i)
    {
      const hardware_interface::ComponentInfo& joint = info_.joints[i];
      // We assume it's a revolute joint unless explicitly specified.
      // Check if a "type" key is present in joint.parameters with value other than "revolute"
      // as per sdformat conventions http://sdformat.org/spec?elem=joint.
      const auto type_it = joint.parameters.find("type");
      const bool is_revolute = type_it != joint.parameters.end() && type_it->second != "revolute" ? false : true;

      // Get the range of the joint from its command interfaces.
      for (const hardware_interface::InterfaceInfo& joint_info : joint.command_interfaces)
      {
        if (joint_info.name == hardware_interface::HW_IF_POSITION)
        {
          const double min = std::stod(joint_info.min);
          const double max = std::stod(joint_info.max);

          abb::robot::StandardizedJoint* p_joint = robot->add_standardized_joints();
          p_joint->set_standardized_name(joint.name);
          p_joint->set_rotating_move(is_revolute);
          p_joint->set_lower_joint_bound(min);
          p_joint->set_upper_joint_bound(max);

          RCLCPP_INFO(LOGGER, "Configured component %s of type %s with range [%.3f, %.3f]", joint.name.c_str(),
                      joint.type.c_str(), min, max);
          break;
        }
      }
    }
  }

  RCLCPP_INFO_STREAM(LOGGER, "Robot controller description:\n"
                                 << abb::robot::summaryText(robot_controller_description_));

  // Configure EGM
  RCLCPP_INFO(LOGGER, "Configuring EGM interface...");

  // Initialize motion data from robot controller description
  try
  {
    abb::robot::initializeMotionData(motion_data_, robot_controller_description_);
  }
  catch (...)
  {
    RCLCPP_ERROR_STREAM(LOGGER, "Failed to initialize motion data from robot controller description");
    return CallbackReturn::ERROR;
  }

  // Create channel configuration for each mechanical unit group
  std::vector<abb::robot::EGMManager::ChannelConfiguration> channel_configurations;
  for (const auto& group : robot_controller_description_.mechanical_units_groups())
  {
    try
    {
      const auto egm_port = stoi(info_.hardware_parameters[group.name() + "egm_port"]);
      const auto channel_configuration =
          abb::robot::EGMManager::ChannelConfiguration{ static_cast<uint16_t>(egm_port), group };
      channel_configurations.emplace_back(channel_configuration);
      RCLCPP_INFO_STREAM(LOGGER,
                         "Configuring EGM for mechanical unit group " << group.name() << " on port " << egm_port);
    }
    catch (std::invalid_argument& e)
    {
      RCLCPP_FATAL_STREAM(LOGGER, "EGM port for mechanical unit group \"" << group.name()
                                                                          << "\" not specified in hardware parameters");
      return CallbackReturn::ERROR;
    }
  }
  try
  {
    egm_manager_ = std::make_unique<abb::robot::EGMManager>(channel_configurations);
  }
  catch (std::runtime_error& e)
  {
    RCLCPP_ERROR_STREAM(LOGGER, "Failed to initialize EGM connection");
    return CallbackReturn::ERROR;
  }

  const auto telemetry_enabled_it = info_.hardware_parameters.find("publish_egm_telemetry");
  if (telemetry_enabled_it != info_.hardware_parameters.end())
  {
    telemetry_enabled_ = telemetry_enabled_it->second != "false" && telemetry_enabled_it->second != "False" &&
                         telemetry_enabled_it->second != "0";
  }
  const auto telemetry_rate_it = info_.hardware_parameters.find("egm_telemetry_publish_rate");
  if (telemetry_rate_it != info_.hardware_parameters.end())
  {
    const double rate = std::stod(telemetry_rate_it->second);
    telemetry_publish_period_ = rate > 0.0 ? 1.0 / rate : 0.0;
  }
  initializeTelemetryPublishers();

  return CallbackReturn::SUCCESS;
}

std::vector<hardware_interface::StateInterface> ABBSystemHardware::export_state_interfaces()
{
  std::vector<hardware_interface::StateInterface> state_interfaces;
  for (auto& group : motion_data_.groups)
  {
    for (auto& unit : group.units)
    {
      for (auto& joint : unit.joints)
      {
        // TODO(seng): Consider changing joint names in robot description to match what comes
        // from the ABB robot description to avoid needing to strip the prefix here
        const auto pos = joint.name.find("joint");
        const auto joint_name = joint.name.substr(pos);
        state_interfaces.emplace_back(
            hardware_interface::StateInterface(joint_name, hardware_interface::HW_IF_POSITION, &joint.state.position));
        state_interfaces.emplace_back(
            hardware_interface::StateInterface(joint_name, hardware_interface::HW_IF_VELOCITY, &joint.state.velocity));
      }
    }
  }
  return state_interfaces;
}

std::vector<hardware_interface::CommandInterface> ABBSystemHardware::export_command_interfaces()
{
  std::vector<hardware_interface::CommandInterface> command_interfaces;
  for (auto& group : motion_data_.groups)
  {
    for (auto& unit : group.units)
    {
      for (auto& joint : unit.joints)
      {
        // TODO(seng): Consider changing joint names in robot description to match what comes
        // from the ABB robot description to avoid needing to strip the prefix here
        const auto pos = joint.name.find("joint");
        const auto joint_name = joint.name.substr(pos);
        command_interfaces.emplace_back(hardware_interface::CommandInterface(
            joint_name, hardware_interface::HW_IF_POSITION, &joint.command.position));
        command_interfaces.emplace_back(hardware_interface::CommandInterface(
            joint_name, hardware_interface::HW_IF_VELOCITY, &joint.command.velocity));
      }
    }
  }

  return command_interfaces;
}

CallbackReturn ABBSystemHardware::on_activate(const rclcpp_lifecycle::State& /* previous_state */)
{
  size_t counter = 0;
  RCLCPP_INFO(LOGGER, "Connecting to robot...");
  while (rclcpp::ok() && counter++ < NUM_CONNECTION_TRIES)
  {
    // Wait for a message on any of the configured EGM channels.
    if (egm_manager_->waitForMessage(500))
    {
      RCLCPP_INFO(LOGGER, "Connected to robot");
      break;
    }

    RCLCPP_INFO(LOGGER, "Not connected to robot...");
    if (counter == NUM_CONNECTION_TRIES)
    {
      RCLCPP_ERROR(LOGGER, "Failed to connect to robot");
      return CallbackReturn::ERROR;
    }
    rclcpp::sleep_for(500ms);
  }

  egm_manager_->read(motion_data_);
  for (auto& group : motion_data_.groups)
  {
    for (auto& unit : group.units)
    {
      for (auto& joint : unit.joints)
      {
        joint.command.position = joint.state.position;
        joint.command.velocity = 0.0;
      }
    }
  }

  RCLCPP_INFO(LOGGER, "ros2_control hardware interface was successfully started!");

  return CallbackReturn::SUCCESS;
}

return_type ABBSystemHardware::read(const rclcpp::Time& time, const rclcpp::Duration& period)
{
  egm_manager_->read(motion_data_);
  publishTelemetry(time);
  return return_type::OK;
}

return_type ABBSystemHardware::write(const rclcpp::Time& time, const rclcpp::Duration& period)
{
  egm_manager_->write(motion_data_);
  return return_type::OK;
}

void ABBSystemHardware::initializeTelemetryPublishers()
{
  if (!telemetry_enabled_ || !rclcpp::ok())
  {
    return;
  }

  telemetry_node_ = std::make_shared<rclcpp::Node>("abb_egm_telemetry");
  egm_state_publisher_ = telemetry_node_->create_publisher<abb_egm_msgs::msg::EGMState>("/egm/state", 10);
  egm_feedback_joint_state_publisher_ =
      telemetry_node_->create_publisher<sensor_msgs::msg::JointState>("/egm/feedback_joint_states", 10);
  egm_planned_joint_state_publisher_ =
      telemetry_node_->create_publisher<sensor_msgs::msg::JointState>("/egm/planned_joint_states", 10);
  egm_feedback_pose_publisher_ =
      telemetry_node_->create_publisher<geometry_msgs::msg::PoseStamped>("/egm/feedback_pose", 10);
  egm_planned_pose_publisher_ =
      telemetry_node_->create_publisher<geometry_msgs::msg::PoseStamped>("/egm/planned_pose", 10);
  egm_raw_input_publisher_ = telemetry_node_->create_publisher<std_msgs::msg::String>("/egm/raw_input", 10);
}

void ABBSystemHardware::publishTelemetry(const rclcpp::Time& time)
{
  if (!telemetry_enabled_ || !telemetry_node_ || telemetry_publish_period_ <= 0.0)
  {
    return;
  }

  if (last_telemetry_publish_time_.nanoseconds() != 0 &&
      (time - last_telemetry_publish_time_).seconds() < telemetry_publish_period_)
  {
    return;
  }

  last_telemetry_publish_time_ = time;
  publishEgmState(time);
  publishJointTelemetry(time, false);
  publishJointTelemetry(time, true);
  publishPoseTelemetry(time, false);
  publishPoseTelemetry(time, true);
  publishRawEgmInput(time);
}

void ABBSystemHardware::publishEgmState(const rclcpp::Time& time)
{
  if (!egm_state_publisher_)
  {
    return;
  }

  abb_egm_msgs::msg::EGMState message;
  message.header.stamp = time;
  message.header.frame_id = "egm";

  for (const auto& group : motion_data_.groups)
  {
    const auto& channel_data = group.egm_channel_data;
    const auto& status = channel_data.input.status();
    abb_egm_msgs::msg::EGMChannelState channel;
    channel.name = group.name.empty() ? "default" : group.name;
    channel.active = channel_data.is_active;
    channel.egm_convergence_met = status.egm_convergence_met();
    channel.egm_client_state = mapEgmState(status.egm_state());
    channel.motor_state = mapMotorState(status.motor_state());
    channel.rapid_execution_state = mapRapidState(status.rapid_execution_state());
    channel.utilization_rate = status.has_utilization_rate() ? status.utilization_rate()
                                                             : std::numeric_limits<double>::quiet_NaN();
    message.egm_channels.push_back(channel);
  }

  egm_state_publisher_->publish(message);
}

void ABBSystemHardware::publishJointTelemetry(const rclcpp::Time& time, const bool planned)
{
  auto publisher = planned ? egm_planned_joint_state_publisher_ : egm_feedback_joint_state_publisher_;
  if (!publisher)
  {
    return;
  }

  sensor_msgs::msg::JointState message;
  message.header.stamp = time;
  message.header.frame_id = planned ? "egm_planned" : "egm_feedback";

  bool velocity_complete = true;
  for (const auto& group : motion_data_.groups)
  {
    const auto& input = group.egm_channel_data.input;
    if (!group.egm_channel_data.is_active)
    {
      continue;
    }
    if (planned)
    {
      appendSourceJointTelemetry(input.planned(), group, message, velocity_complete);
    }
    else
    {
      appendSourceJointTelemetry(input.feedback(), group, message, velocity_complete);
    }
  }

  if (message.name.empty() || message.position.empty())
  {
    return;
  }
  if (!velocity_complete || message.velocity.size() != message.position.size())
  {
    message.velocity.clear();
  }
  publisher->publish(message);
}

void ABBSystemHardware::publishPoseTelemetry(const rclcpp::Time& time, const bool planned)
{
  auto publisher = planned ? egm_planned_pose_publisher_ : egm_feedback_pose_publisher_;
  if (!publisher)
  {
    return;
  }

  for (const auto& group : motion_data_.groups)
  {
    if (!group.egm_channel_data.is_active)
    {
      continue;
    }
    const auto& input = group.egm_channel_data.input;
    geometry_msgs::msg::PoseStamped message;
    const auto frame_id = group.name.empty() ? "egm" : group.name;
    const bool has_pose = planned ? fillPoseMessage(input.planned(), frame_id, time, message)
                                  : fillPoseMessage(input.feedback(), frame_id, time, message);
    if (!has_pose)
    {
      continue;
    }

    publisher->publish(message);
    return;
  }
}

void ABBSystemHardware::publishRawEgmInput(const rclcpp::Time& time)
{
  if (!egm_raw_input_publisher_)
  {
    return;
  }

  std::ostringstream stream;
  stream << "{\"stamp\":" << time.seconds() << ",\"channels\":[";
  bool first_channel = true;
  for (const auto& group : motion_data_.groups)
  {
    if (!group.egm_channel_data.is_active)
    {
      continue;
    }
    if (!first_channel)
    {
      stream << ",";
    }
    first_channel = false;
    const auto& input = group.egm_channel_data.input;
    const auto& status = input.status();
    stream << "{\"name\":\"" << (group.name.empty() ? "default" : group.name) << "\"";
    stream << ",\"sequence_number\":" << input.header().sequence_number();
    stream << ",\"controller_time_ms\":" << input.header().time_stamp();
    stream << ",\"active\":true";
    stream << ",\"egm_state\":" << static_cast<int>(mapEgmState(status.egm_state()));
    stream << ",\"motor_state\":" << static_cast<int>(mapMotorState(status.motor_state()));
    stream << ",\"rapid_execution_state\":" << static_cast<int>(mapRapidState(status.rapid_execution_state()));
    stream << ",\"egm_convergence_met\":" << (status.egm_convergence_met() ? "true" : "false");
    stream << ",\"utilization_rate\":";
    if (status.has_utilization_rate())
    {
      stream << status.utilization_rate();
    }
    else
    {
      stream << "null";
    }
    stream << ",\"feedback\":";
    if (input.has_feedback() && input.feedback().has_robot())
    {
      appendRobotJson(stream, input.feedback().robot());
    }
    else
    {
      stream << "null";
    }
    stream << ",\"planned\":";
    if (input.has_planned() && input.planned().has_robot())
    {
      appendRobotJson(stream, input.planned().robot());
    }
    else
    {
      stream << "null";
    }
    stream << "}";
  }
  stream << "]}";

  std_msgs::msg::String message;
  message.data = stream.str();
  egm_raw_input_publisher_->publish(message);
}

}  // namespace abb_hardware_interface

#include "pluginlib/class_list_macros.hpp"

PLUGINLIB_EXPORT_CLASS(abb_hardware_interface::ABBSystemHardware, hardware_interface::SystemInterface)
