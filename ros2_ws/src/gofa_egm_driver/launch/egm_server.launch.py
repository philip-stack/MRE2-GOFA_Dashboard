from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():
    return LaunchDescription(
        [
            DeclareLaunchArgument("host", default_value="0.0.0.0"),
            DeclareLaunchArgument("port", default_value="6511"),
            DeclareLaunchArgument("armed", default_value="false"),
            Node(
                package="gofa_egm_driver",
                executable="egm_trajectory_server",
                output="screen",
                parameters=[
                    {
                        "host": LaunchConfiguration("host"),
                        "port": LaunchConfiguration("port"),
                        "armed": LaunchConfiguration("armed"),
                    }
                ],
            ),
        ]
    )
