import os

import yaml
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.conditions import IfCondition
from launch.substitutions import Command, FindExecutable, LaunchConfiguration, PathJoinSubstitution
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue
from launch_ros.substitutions import FindPackageShare


def load_yaml(package_name, relative_path):
    package_path = get_package_share_directory(package_name)
    absolute_path = os.path.join(package_path, relative_path)
    with open(absolute_path, "r", encoding="utf-8") as file:
        return yaml.safe_load(file)


def load_text(package_name, relative_path):
    package_path = get_package_share_directory(package_name)
    absolute_path = os.path.join(package_path, relative_path)
    with open(absolute_path, "r", encoding="utf-8") as file:
        return file.read()


def generate_launch_description():
    use_rviz = LaunchConfiguration("use_rviz")
    armed = LaunchConfiguration("armed")
    egm_host = LaunchConfiguration("egm_host")
    egm_port = LaunchConfiguration("egm_port")

    robot_description_content = Command(
        [
            PathJoinSubstitution([FindExecutable(name="xacro")]),
            " ",
            PathJoinSubstitution([FindPackageShare("gofa_description"), "urdf", "gofa.urdf.xacro"]),
        ]
    )
    robot_description = {
        "robot_description": ParameterValue(robot_description_content, value_type=str)
    }

    robot_description_semantic = {
        "robot_description_semantic": load_text("gofa_moveit_config", "config/gofa.srdf")
    }
    robot_description_kinematics = {
        "robot_description_kinematics": load_yaml("gofa_moveit_config", "config/kinematics.yaml")
    }
    joint_limits = {
        "robot_description_planning": load_yaml("gofa_moveit_config", "config/joint_limits.yaml")
    }
    planning_pipelines = {
        "planning_pipelines": ["ompl"],
        "default_planning_pipeline": "ompl",
        "ompl": load_yaml("gofa_moveit_config", "config/ompl_planning.yaml"),
    }
    trajectory_execution = {
        "moveit_manage_controllers": False,
        "trajectory_execution": {
            "allowed_execution_duration_scaling": 1.5,
            "allowed_goal_duration_margin": 2.0,
            "allowed_start_tolerance": 0.05,
        },
    }
    planning_scene_monitor = {
        "publish_planning_scene": True,
        "publish_geometry_updates": True,
        "publish_state_updates": True,
        "publish_transforms_updates": True,
    }
    moveit_controllers = load_yaml("gofa_moveit_config", "config/moveit_controllers.yaml")

    robot_state_publisher = Node(
        package="robot_state_publisher",
        executable="robot_state_publisher",
        output="screen",
        parameters=[robot_description],
    )

    egm_server = Node(
        package="gofa_egm_driver",
        executable="egm_trajectory_server",
        output="screen",
        parameters=[
            {
                "host": egm_host,
                "port": egm_port,
                "armed": armed,
                "max_step_deg": 0.35,
                "goal_tolerance_rad": 0.025,
            }
        ],
    )

    move_group = Node(
        package="moveit_ros_move_group",
        executable="move_group",
        output="screen",
        parameters=[
            robot_description,
            robot_description_semantic,
            robot_description_kinematics,
            joint_limits,
            planning_pipelines,
            trajectory_execution,
            planning_scene_monitor,
            moveit_controllers,
        ],
    )

    rviz_config = os.path.join(
        get_package_share_directory("gofa_moveit_config"), "config", "moveit.rviz"
    )
    rviz = Node(
        package="rviz2",
        executable="rviz2",
        name="rviz2",
        output="log",
        condition=IfCondition(use_rviz),
        arguments=["-d", rviz_config],
        parameters=[
            robot_description,
            robot_description_semantic,
            robot_description_kinematics,
            joint_limits,
            planning_pipelines,
        ],
    )

    return LaunchDescription(
        [
            DeclareLaunchArgument("use_rviz", default_value="true"),
            DeclareLaunchArgument(
                "armed",
                default_value="false",
                description="When false, EGM replies hold current position and rejects MoveIt execution.",
            ),
            DeclareLaunchArgument("egm_host", default_value="0.0.0.0"),
            DeclareLaunchArgument("egm_port", default_value="6511"),
            robot_state_publisher,
            egm_server,
            move_group,
            rviz,
        ]
    )
